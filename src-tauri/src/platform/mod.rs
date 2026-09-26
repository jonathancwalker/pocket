use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Gesture {
    held: Option<(u16, u64)>,
    first: Option<(u16, u64)>,
}
impl Gesture {
    pub fn event(&mut self, code: u16, time: u64, down: bool, isolated: bool) -> bool {
        if !isolated || !matches!(code, 54 | 55) {
            self.held = None;
            self.first = None;
            return false;
        }
        if down {
            if self.held.is_some() {
                self.held = None;
                self.first = None;
                return false;
            }
            if self
                .first
                .is_some_and(|(c, t)| c != code || time.saturating_sub(t) > 300)
            {
                self.first = None;
            }
            self.held = Some((code, time));
            false
        } else {
            let held = self.held.take();
            if !held.is_some_and(|(c, t)| c == code && time.saturating_sub(t) <= 250) {
                self.first = None;
                return false;
            }
            if self
                .first
                .take()
                .is_some_and(|(c, t)| c == code && held.unwrap().1.saturating_sub(t) <= 300)
            {
                true
            } else {
                self.first = Some((code, time));
                false
            }
        }
    }
}
static APP: OnceLock<AppHandle> = OnceLock::new();
static GESTURE: Mutex<Gesture> = Mutex::new(Gesture {
    held: None,
    first: None,
});
pub fn initialize(app: AppHandle) {
    let _ = APP.set(app);
}
#[cfg(target_os = "macos")]
extern "C" {
    fn ic_configure_capture(window: *mut std::ffi::c_void);
    fn ic_configure_library(window: *mut std::ffi::c_void);
    fn ic_fade_capture(
        window: *mut std::ffi::c_void,
        reduced_motion: bool,
        callback: extern "C" fn(*mut std::ffi::c_void),
        context: *mut std::ffi::c_void,
    );
    fn ic_reveal_capture(window: *mut std::ffi::c_void);
    fn ic_dismiss_capture(
        window: *mut std::ffi::c_void,
        callback: extern "C" fn(*mut std::ffi::c_void),
        context: *mut std::ffi::c_void,
    );
    #[cfg(feature = "webdriver")]
    fn ic_capture_alpha(window: *mut std::ffi::c_void) -> f64;
    #[cfg(feature = "webdriver")]
    fn ic_capture_glass_width(window: *mut std::ffi::c_void) -> f64;
    #[cfg(feature = "webdriver")]
    fn ic_library_key_events() -> u64;
    #[cfg(feature = "webdriver")]
    fn ic_frontmost_pid() -> i32;
    fn ic_record_shortcut(
        window: *mut std::ffi::c_void,
        enabled: bool,
        callback: extern "C" fn(u16, u32, bool),
    );
    fn ic_position_capture(window: *mut std::ffi::c_void);
    fn ic_remember_target();
    fn ic_activate();
    fn ic_restore_focus();
    fn ic_gesture(
        enabled: bool,
        prompt: bool,
        callback: extern "C" fn(u16, u64, bool, u32),
    ) -> bool;
}
extern "C" fn gesture_event(code: u16, time: u64, down: bool, kind: u32) {
    let fires = GESTURE
        .lock()
        .map(|mut g| g.event(code, time, down, kind == 1))
        .unwrap_or(false);
    if fires {
        if let Some(app) = APP.get() {
            if !crate::is_recording(app) {
                crate::request_capture(app);
            }
        }
    }
}
extern "C" fn recorded_key(code: u16, flags: u32, down: bool) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to(
            "library",
            "shortcut-key",
            serde_json::json!({"code":code,"flags":flags,"down":down}),
        );
    }
}
pub fn record_shortcut(window: &tauri::WebviewWindow, enabled: bool) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        unsafe {
            ic_record_shortcut(pointer, enabled, recorded_key);
        }
    }
}
pub async fn fade_capture(
    window: &tauri::WebviewWindow,
    reduced_motion: bool,
) -> Result<(), String> {
    close_capture(window, Some(reduced_motion)).await
}
pub async fn dismiss_capture(window: &tauri::WebviewWindow) -> Result<(), String> {
    close_capture(window, None).await
}
async fn close_capture(window: &tauri::WebviewWindow, fade: Option<bool>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        type Completion = tokio::sync::oneshot::Sender<Result<(), String>>;
        extern "C" fn complete(context: *mut std::ffi::c_void) {
            // AppKit calls completion exactly once, after the focus handoff and orderOut.
            let sender = unsafe { Box::from_raw(context.cast::<Completion>()) };
            let _ = sender.send(Ok(()));
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let capture = window.clone();
        window
            .run_on_main_thread(move || match capture.ns_window() {
                Ok(pointer) => unsafe {
                    let context = Box::into_raw(Box::new(sender)).cast();
                    if let Some(reduced_motion) = fade {
                        ic_fade_capture(pointer, reduced_motion, complete, context);
                    } else {
                        ic_dismiss_capture(pointer, complete, context);
                    }
                },
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;
        receiver.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = fade;
        window.hide().map_err(|e| e.to_string())
    }
}
pub fn reveal_capture(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        unsafe { ic_reveal_capture(pointer) };
    }
}
#[cfg(feature = "webdriver")]
pub fn capture_surface(window: &tauri::WebviewWindow) -> (f64, f64) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        return unsafe { (ic_capture_alpha(pointer), ic_capture_glass_width(pointer)) };
    }
    (1., 0.)
}
#[cfg(feature = "webdriver")]
pub fn focus_surface() -> (u64, i32) {
    #[cfg(target_os = "macos")]
    return unsafe { (ic_library_key_events(), ic_frontmost_pid()) };
    #[cfg(not(target_os = "macos"))]
    (0, 0)
}
pub fn gesture(enabled: bool, prompt: bool) -> bool {
    if let Ok(mut g) = GESTURE.lock() {
        *g = Gesture::default();
    }
    #[cfg(target_os = "macos")]
    unsafe {
        ic_gesture(enabled, prompt, gesture_event)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (enabled, prompt);
        !enabled
    }
}
pub fn configure(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        unsafe {
            ic_configure_capture(pointer);
        }
    }
}
pub fn position(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        unsafe {
            ic_position_capture(pointer);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.center();
    }
}
pub fn configure_library(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        unsafe {
            ic_configure_library(pointer);
        }
    }
}
pub fn remember() {
    #[cfg(target_os = "macos")]
    unsafe {
        ic_remember_target();
    }
}
pub fn activate() {
    #[cfg(target_os = "macos")]
    unsafe {
        ic_activate();
    }
}
pub fn restore() {
    #[cfg(target_os = "macos")]
    unsafe {
        ic_restore_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_only_two_complete_isolated_same_side_taps() {
        let mut g = Gesture::default();
        assert!(!g.event(55, 0, true, true));
        assert!(!g.event(55, 70, false, true));
        assert!(!g.event(55, 160, true, true));
        assert!(g.event(55, 220, false, true));
        assert!(!g.event(55, 300, true, true));
        assert!(!g.event(8, 330, true, false));
        assert!(!g.event(55, 380, false, true));
        assert!(!g.event(55, 430, true, true));
        assert!(!g.event(55, 480, false, true));
        assert!(!g.event(54, 500, true, true));
        assert!(!g.event(54, 550, false, true));
    }
    #[test]
    fn ignores_hold_and_expired_gap() {
        let mut g = Gesture::default();
        g.event(55, 0, true, true);
        assert!(!g.event(55, 400, false, true));
        g.event(55, 450, true, true);
        assert!(!g.event(55, 500, false, true));
        g.event(55, 900, true, true);
        assert!(!g.event(55, 950, false, true));
    }
}
