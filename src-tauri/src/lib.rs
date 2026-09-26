mod platform;
mod shortcut;
mod storage;
mod titles;

use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use storage::{AppError, Database, Result};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Lifecycle {
    ready: HashSet<String>,
    pending_capture: bool,
    capture_closing: bool,
    capture_return_focus: bool,
    pending_library: bool,
    quit_waiting: HashSet<String>,
    quit_token: u64,
    shortcut_error: Option<String>,
    active_shortcut: String,
    recording: bool,
    taps: shortcut::ShortcutTaps,
}
struct Runtime {
    lifecycle: Mutex<Lifecycle>,
    exiting: AtomicBool,
    title_settings_path: std::path::PathBuf,
}
fn native_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "native",
        &format!("The system action could not finish: {error}"),
    )
}
fn authorize(window: &WebviewWindow, library_only: bool) -> Result<()> {
    if window.label() == "library" || (!library_only && window.label() == "capture") {
        Ok(())
    } else {
        Err(AppError::new(
            "permission",
            "This window cannot perform that operation.",
        ))
    }
}

pub(crate) fn is_recording(app: &AppHandle) -> bool {
    app.state::<Runtime>()
        .lifecycle
        .lock()
        .map(|l| l.recording)
        .unwrap_or(false)
}
fn handle_shortcut(app: &AppHandle, pressed: bool) {
    let route = {
        let state = app.state::<Runtime>();
        let Ok(mut life) = state.lifecycle.lock() else {
            return;
        };
        if life.recording {
            return;
        }
        life.taps.event(pressed, std::time::Instant::now())
    };
    match route {
        Some(shortcut::Doorway::Capture) => request_capture(app),
        Some(shortcut::Doorway::Library) => {
            let ready = app
                .state::<Runtime>()
                .lifecycle
                .lock()
                .map(|l| l.ready.contains("capture"))
                .unwrap_or(false);
            if ready {
                let _ = app.emit_to("capture", "capture-open-library", ());
            } else {
                let _ = request_library(app);
            }
        }
        None => {}
    }
}

fn set_recording(app: &AppHandle, enabled: bool) -> Result<()> {
    let shortcut = {
        let state = app.state::<Runtime>();
        let mut life = state.lifecycle.lock().map_err(native_error)?;
        if life.recording == enabled {
            return Ok(());
        }
        life.recording = enabled;
        life.taps = shortcut::ShortcutTaps::default();
        life.active_shortcut.clone()
    };
    let registered = app.global_shortcut().is_registered(shortcut.as_str());
    let result = if enabled && registered {
        app.global_shortcut().unregister(shortcut.as_str())
    } else if enabled || registered {
        Ok(())
    } else {
        app.global_shortcut().register(shortcut.as_str())
    };
    if let Err(error) = result {
        if let Ok(mut life) = app.state::<Runtime>().lifecycle.lock() {
            life.recording = false;
            life.shortcut_error = Some(error.to_string());
        }
        if let Some(window) = app.get_webview_window("library") {
            platform::record_shortcut(&window, false);
        }
        return Err(native_error(error));
    }
    if let Some(window) = app.get_webview_window("library") {
        platform::record_shortcut(&window, enabled);
    }
    Ok(())
}
#[tauri::command]
fn shortcut_recording(window: WebviewWindow, app: AppHandle, enabled: bool) -> Result<()> {
    authorize(&window, true)?;
    set_recording(&app, enabled)
}
#[tauri::command]
async fn capture_fade(window: WebviewWindow, app: AppHandle, reduced_motion: bool) -> Result<()> {
    if window.label() != "capture" {
        return Err(AppError::new(
            "permission",
            "Only capture can close this surface.",
        ));
    }
    // Query Cocoa before locking lifecycle: a shortcut on the main thread may
    // need the same lock while this async command is waiting for that thread.
    let focused = window.is_focused().unwrap_or(false);
    {
        let state = app.state::<Runtime>();
        let mut life = state.lifecycle.lock().map_err(native_error)?;
        life.capture_closing = true;
        life.capture_return_focus = focused;
    }
    platform::fade_capture(&window, reduced_motion)
        .await
        .map_err(native_error)
}

#[tauri::command]
fn capture_finished(
    window: WebviewWindow,
    app: AppHandle,
    reopen: bool,
    library: bool,
) -> Result<()> {
    if window.label() != "capture" {
        return Err(AppError::new(
            "permission",
            "Only capture can finish this surface.",
        ));
    }
    let (pending, return_focus) = {
        let state = app.state::<Runtime>();
        let mut life = state.lifecycle.lock().map_err(native_error)?;
        life.capture_closing = false;
        (
            std::mem::take(&mut life.pending_capture),
            std::mem::take(&mut life.capture_return_focus),
        )
    };
    if library {
        request_library(&app)?;
    } else if reopen || pending {
        request_capture(&app);
    } else if return_focus {
        platform::restore();
    }
    Ok(())
}

#[cfg(feature = "webdriver")]
#[tauri::command]
fn capture_surface(app: AppHandle) -> Result<Value> {
    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| AppError::new("native", "Capture is unavailable."))?;
    let (alpha, glass_width) = platform::capture_surface(&window);
    let (library_key_events, frontmost_pid) = platform::focus_surface();
    Ok(
        json!({"visible":window.is_visible().map_err(native_error)?, "alpha":alpha, "glassWidth":glass_width,
            "height":window.inner_size().map_err(native_error)?.height as f64 / window.scale_factor().map_err(native_error)?,
            "libraryKeyEvents":library_key_events, "frontmostPid":frontmost_pid}),
    )
}

#[tauri::command]
async fn storage(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
    operation: String,
    input: Value,
) -> Result<Value> {
    let capture_operation = matches!(
        operation.as_str(),
        "get_draft" | "save_draft" | "discard_draft" | "commit_capture" | "get_settings"
    );
    authorize(&window, !capture_operation)?;
    if matches!(operation.as_str(), "set_settings") {
        return Err(AppError::new(
            "permission",
            "Use the settings operation to update system preferences.",
        ));
    }
    let result = db.call(&operation, input).await?;
    if matches!(
        operation.as_str(),
        "commit_capture"
            | "set_generated_title"
            | "update_content"
            | "set_starred"
            | "set_archived"
            | "create_tag"
            | "rename_tag"
            | "delete_tag"
            | "set_tag"
            | "add_link"
            | "remove_link"
    ) {
        let _ = app.emit(
            "library-changed",
            json!({"operation":operation,"id":result.get("id"),"revision":result.get("revision")}),
        );
    }
    Ok(result)
}

pub(crate) fn request_capture(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = app2.state::<Runtime>();
        let Ok(mut life) = state.lifecycle.lock() else {
            return;
        };
        if !life.ready.contains("capture") || life.capture_closing {
            life.pending_capture = true;
            return;
        }
        drop(life);
        if let Some(window) = app2.get_webview_window("capture") {
            if !window.is_visible().unwrap_or(false) {
                platform::remember();
                platform::position(&window);
            }
            platform::reveal_capture(&window);
            let _ = window.show();
            platform::activate();
            let _ = window.set_focus();
            let _ = window.emit("capture-shown", ());
        }
    });
}
fn request_library(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("library") {
        let ready = app
            .state::<Runtime>()
            .lifecycle
            .lock()
            .map(|l| l.ready.contains("library"))
            .unwrap_or(false);
        if ready {
            window.show().map_err(native_error)?;
            platform::activate();
            window.set_focus().map_err(native_error)?;
        } else if let Ok(mut life) = app.state::<Runtime>().lifecycle.lock() {
            life.pending_library = true;
        }
    } else {
        if let Ok(mut life) = app.state::<Runtime>().lifecycle.lock() {
            life.pending_library = true;
        }
        let library = tauri::WebviewWindowBuilder::new(
            app,
            "library",
            tauri::WebviewUrl::App("index.html?window=library".into()),
        )
        .title("Pocket")
        .inner_size(1120., 780.)
        .min_inner_size(800., 560.)
        .visible(false)
        .transparent(true)
        .center()
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()
        .map_err(native_error)?;
        platform::configure_library(&library);
    }
    Ok(())
}

#[tauri::command]
fn window_ready(window: WebviewWindow, app: AppHandle) -> Result<()> {
    authorize(&window, false)?;
    let state = app.state::<Runtime>();
    let mut life = state.lifecycle.lock().map_err(native_error)?;
    life.ready.insert(window.label().into());
    let show_capture = window.label() == "capture" && life.pending_capture;
    let show_library = window.label() == "library" && life.pending_library;
    if show_capture {
        life.pending_capture = false;
    }
    if show_library {
        life.pending_library = false;
    }
    drop(life);
    if show_capture {
        request_capture(&app);
    }
    if show_library {
        request_library(&app)?;
    }
    Ok(())
}
#[tauri::command]
fn window_action(
    window: WebviewWindow,
    app: AppHandle,
    action: String,
    height: Option<f64>,
) -> Result<()> {
    authorize(&window, false)?;
    match action.as_str() {
        #[cfg(feature = "webdriver")]
        "test-shortcut-down" => handle_shortcut(&app, true),
        #[cfg(feature = "webdriver")]
        "test-shortcut-up" => handle_shortcut(&app, false),
        "capture" => request_capture(&app),
        "library" => {
            request_library(&app)?;
            if window.label() == "capture" {
                if let Ok(mut life) = app.state::<Runtime>().lifecycle.lock() {
                    life.pending_capture = false;
                }
                window.hide().map_err(native_error)?;
            }
        }
        "dismiss" | "dismiss-blurred" => {
            let focused = window.is_focused().unwrap_or(false);
            if action == "dismiss-blurred"
                && (window.label() != "capture" || focused || !window.is_visible().unwrap_or(false))
            {
                return Ok(());
            }
            if window.label() == "capture" {
                {
                    let state = app.state::<Runtime>();
                    let mut life = state.lifecycle.lock().map_err(native_error)?;
                    if life.capture_closing {
                        return Ok(());
                    }
                    life.capture_closing = true;
                }
                let closing_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let failed = platform::dismiss_capture(&window).await.is_err();
                    let main_app = closing_app.clone();
                    let _ = closing_app.run_on_main_thread(move || {
                        let _ = capture_finished(window, main_app, failed, false);
                    });
                });
            } else {
                window.hide().map_err(native_error)?;
            }
        }
        "resize" if window.label() == "capture" => {
            let maximum = window
                .current_monitor()
                .ok()
                .flatten()
                .map(|m| m.size().height as f64 / m.scale_factor() - 120.)
                .unwrap_or(650.);
            let height = height.unwrap_or(110.).clamp(110., maximum.max(110.));
            let position = window.outer_position().ok();
            window
                .set_size(tauri::LogicalSize::new(640., height))
                .map_err(native_error)?;
            if let Some(position) = position {
                let _ = window.set_position(position);
            }
        }
        "quit" => request_quit(&app),
        _ => return Err(AppError::new("validation", "Unknown window action.")),
    }
    Ok(())
}
fn request_quit(app: &AppHandle) {
    let state = app.state::<Runtime>();
    let Ok(mut life) = state.lifecycle.lock() else {
        return;
    };
    if !life.quit_waiting.is_empty() {
        return;
    }
    life.quit_token += 1;
    life.quit_waiting = life.ready.clone();
    let token = life.quit_token;
    let empty = life.quit_waiting.is_empty();
    drop(life);
    if empty {
        state.exiting.store(true, Ordering::SeqCst);
        app.exit(0);
    } else {
        let _ = app.emit("prepare-quit", json!({"token":token}));
    }
}
#[tauri::command]
fn quit_ack(window: WebviewWindow, app: AppHandle, token: u64, saved: bool) -> Result<()> {
    authorize(&window, false)?;
    let state = app.state::<Runtime>();
    let mut life = state.lifecycle.lock().map_err(native_error)?;
    if token != life.quit_token || life.quit_waiting.is_empty() {
        return Ok(());
    }
    if !saved {
        life.quit_waiting.clear();
        drop(life);
        window.show().map_err(native_error)?;
        window.set_focus().map_err(native_error)?;
        let _ = app.emit("quit-cancelled", ());
        return Ok(());
    }
    life.quit_waiting.remove(window.label());
    if life.quit_waiting.is_empty() {
        state.exiting.store(true, Ordering::SeqCst);
        drop(life);
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
async fn system_info(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Value> {
    authorize(&window, true)?;
    let settings = db.call("get_settings", Value::Null).await?;
    Ok(
        json!({"settings":settings,"shortcutError":app.state::<Runtime>().lifecycle.lock().map_err(native_error)?.shortcut_error}),
    )
}
#[tauri::command]
async fn update_settings(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
    settings: Value,
) -> Result<Value> {
    authorize(&window, true)?;
    let previous = db.call("get_settings", Value::Null).await?;
    let shortcut = settings["shortcut"]
        .as_str()
        .ok_or_else(|| AppError::new("validation", "Choose a keyboard shortcut."))?;
    let old = previous["shortcut"]
        .as_str()
        .unwrap_or("CommandOrControl+Shift+Space");
    let new_binding = shortcut != old || !app.global_shortcut().is_registered(shortcut);
    if new_binding {
        app.global_shortcut().register(shortcut).map_err(|_| {
            AppError::new(
                "shortcut",
                "That shortcut is unavailable. Your previous shortcut is still active.",
            )
        })?;
    }
    let enabled = settings["doubleCommand"].as_bool().unwrap_or(false);
    if enabled != previous["doubleCommand"].as_bool().unwrap_or(false) {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = sender.send(platform::gesture(enabled, true));
        })
        .map_err(native_error)?;
        if !receiver.await.unwrap_or(false) {
            if new_binding {
                let _ = app.global_shortcut().unregister(shortcut);
            }
            return Err(AppError::new("accessibility","Allow Pocket in System Settings → Privacy & Security → Accessibility, then enable double Command again. Your normal shortcut still works."));
        }
    }
    let login = settings["launchAtLogin"].as_bool().unwrap_or(false);
    if login != previous["launchAtLogin"].as_bool().unwrap_or(false) {
        let result = if login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = result {
            if new_binding {
                let _ = app.global_shortcut().unregister(shortcut);
            }
            let old_gesture = previous["doubleCommand"].as_bool().unwrap_or(false);
            let _ = app.run_on_main_thread(move || {
                platform::gesture(old_gesture, false);
            });
            return Err(native_error(error));
        }
    }
    let save = db.call("set_settings", settings.clone()).await;
    if let Err(error) = save {
        if new_binding {
            let _ = app.global_shortcut().unregister(shortcut);
        }
        let old_login = previous["launchAtLogin"].as_bool().unwrap_or(false);
        if old_login {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
        let old_gesture = previous["doubleCommand"].as_bool().unwrap_or(false);
        let _ = app.run_on_main_thread(move || {
            platform::gesture(old_gesture, false);
        });
        return Err(error);
    }
    if new_binding && shortcut != old {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Ok(mut life) = app.state::<Runtime>().lifecycle.lock() {
        life.shortcut_error = None;
        life.active_shortcut = shortcut.into();
        life.taps = shortcut::ShortcutTaps::default();
    }
    let _ = app.emit("settings-changed", settings.clone());
    Ok(settings)
}
#[tauri::command]
fn title_key_status(window: WebviewWindow, app: AppHandle) -> Result<Value> {
    authorize(&window, true)?;
    Ok(json!({"hasKey":titles::has_api_key(&app.state::<Runtime>().title_settings_path)?}))
}
#[tauri::command]
fn save_title_key(window: WebviewWindow, app: AppHandle, key: String) -> Result<()> {
    authorize(&window, true)?;
    titles::save_api_key(&app.state::<Runtime>().title_settings_path, &key)
}
#[tauri::command]
fn clear_title_key(window: WebviewWindow, app: AppHandle) -> Result<()> {
    authorize(&window, true)?;
    titles::clear_api_key(&app.state::<Runtime>().title_settings_path)
}
#[tauri::command]
async fn generate_capture_title(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<Value> {
    authorize(&window, false)?;
    let idea = db.call("get_idea", json!({"id":id})).await?;
    let Some(fallback_title) = idea["title"].as_str() else {
        return Ok(idea);
    };
    let revision = idea["revision"].as_i64().unwrap_or_default();
    let capture = idea["captureText"].as_str().unwrap_or_default();
    let title_settings_path = app.state::<Runtime>().title_settings_path.clone();
    let saved = match titles::generate(&title_settings_path, capture).await {
        Ok(title) => db
            .call(
                "set_generated_title",
                json!({"id":id,"expectedTitle":fallback_title,"expectedRevision":revision,"title":title}),
            )
            .await?,
        Err(_) => db
            .call(
                "set_title_status",
                json!({"id":id,"expectedTitle":fallback_title,"expectedRevision":revision,"status":"fallback"}),
            )
            .await?,
    };
    if saved["revision"].as_i64() != Some(revision) {
        let _ = app.emit(
            "library-changed",
            json!({"operation":"set_generated_title","id":saved.get("id"),"revision":saved.get("revision")}),
        );
    }
    Ok(saved)
}
#[tauri::command]
async fn generate_title_candidates(
    app: &AppHandle,
    db: &Database,
    candidates_operation: &str,
    event_operation: &str,
) -> Result<Value> {
    let candidates = db.call(candidates_operation, Value::Null).await?;
    let title_settings_path = app.state::<Runtime>().title_settings_path.clone();
    let mut titled = 0;
    let mut failed = 0;
    for idea in candidates.as_array().into_iter().flatten() {
        let (Some(id), Some(revision)) = (
            idea["id"].as_str(),
            idea["revision"].as_i64(),
        ) else {
            continue;
        };
        let original_title = idea["title"].as_str();
        let capture = idea["captureText"].as_str().unwrap_or_default();
        let context = if capture.trim().is_empty() {
            storage::body_text(&idea["body"], idea["bodySchemaVersion"].as_i64().unwrap_or(1))?
        } else {
            capture.to_string()
        };
        if context.trim().is_empty() {
            failed += 1;
            continue;
        }
        match titles::generate(&title_settings_path, &context).await {
            Ok(generated) => {
                let saved = db
                    .call(
                        "set_generated_title",
                        json!({"id":id,"expectedTitle":idea["title"],"expectedRevision":revision,"title":generated}),
                    )
                    .await?;
                if saved["title"].as_str() != original_title {
                    titled += 1;
                }
            }
            Err(_) => failed += 1,
        }
    }
    if titled > 0 {
        let _ = app.emit("library-changed", json!({"operation":event_operation}));
    }
    Ok(json!({"titled":titled,"failed":failed}))
}
#[tauri::command]
async fn generate_untitled_titles(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Value> {
    authorize(&window, true)?;
    generate_title_candidates(&app, &db, "untitled_title_candidates", "generate_untitled_titles").await
}
#[tauri::command]
async fn shorten_generated_titles(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Value> {
    authorize(&window, true)?;
    generate_title_candidates(&app, &db, "generated_title_candidates", "shorten_generated_titles").await
}
#[tauri::command]
fn open_reference(window: WebviewWindow, app: AppHandle, url: String) -> Result<()> {
    authorize(&window, false)?;
    let valid = storage::reference(&uuid::Uuid::new_v4().to_string(), &url)?;
    app.opener()
        .open_url(valid.url, None::<&str>)
        .map_err(native_error)
}
#[tauri::command]
async fn export_library(
    window: WebviewWindow,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Option<String>> {
    authorize(&window, true)?;
    let chooser = app.clone();
    let destination = tauri::async_runtime::spawn_blocking(move || {
        chooser
            .dialog()
            .file()
            .set_file_name("pocket-backup.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(native_error)?;
    let Some(destination) = destination else {
        return Ok(None);
    };
    let path = destination.into_path().map_err(native_error)?;
    let data = db.call("export_data", Value::Null).await?;
    let text = serde_json::to_vec_pretty(&data)?;
    let output = path.to_string_lossy().to_string();
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        use std::io::Write;
        let temporary = path.with_file_name(format!(".idea-export-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(&text)?;
            file.sync_all()?;
            std::fs::rename(&temporary, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    })
    .await
    .map_err(native_error)??;
    Ok(Some(output))
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let app=builder
        .plugin(tauri_plugin_single_instance::init(|app,_,_| {let _=request_library(app);}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent,Some(vec!["--background"])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,_,event| {handle_shortcut(app,event.state()==ShortcutState::Pressed);}).build())
        .invoke_handler(tauri::generate_handler![storage,window_ready,window_action,quit_ack,system_info,update_settings,title_key_status,save_title_key,clear_title_key,generate_capture_title,generate_untitled_titles,shorten_generated_titles,open_reference,export_library,shortcut_recording,capture_fade,capture_finished,
            #[cfg(feature = "webdriver")]
            capture_surface
        ])
        .setup(|app| {
            let directory=if let Some(path)=std::env::var_os("IDEA_CAPTURE_DATA_DIR") {std::path::PathBuf::from(path)} else {
                let root=app.path().app_data_dir()?;
                if cfg!(debug_assertions) {root.join("development")} else {root}
            };
            let path=directory.join("ideas.sqlite3");
            let title_settings_path=directory.join("title-settings.json");
            let database=match Database::start(&path) {Ok(db)=>db,Err(error)=>{app.dialog().message(format!("{}\n\nLibrary: {}",error.message,path.display())).title("Could not open Pocket").blocking_show();return Err(error.into());}};
            let settings=tauri::async_runtime::block_on(database.call("get_settings",Value::Null))?;
            app.manage(database);
            app.manage(Runtime{lifecycle:Mutex::new(Lifecycle::default()),exiting:AtomicBool::new(false),title_settings_path});
            platform::initialize(app.handle().clone());
            if let Some(capture)=app.get_webview_window("capture") {platform::configure(&capture);}
            let shortcut=settings["shortcut"].as_str().unwrap_or("CommandOrControl+Shift+Space");
            if let Ok(mut life)=app.state::<Runtime>().lifecycle.lock() {life.active_shortcut=shortcut.into();}
            if app.global_shortcut().register(shortcut).is_err() {
                if let Ok(mut life)=app.state::<Runtime>().lifecycle.lock() {life.shortcut_error=Some("Your capture shortcut is unavailable. Choose another in Settings; the menu bar still opens capture.".into());}
            }
            if settings["doubleCommand"].as_bool()==Some(true) && !platform::gesture(true,false) {
                if let Ok(mut life)=app.state::<Runtime>().lifecycle.lock() {life.shortcut_error=Some("Double Command needs Accessibility permission. Your conventional shortcut is still available.".into());}
            }
            use tauri::menu::{Menu,MenuItem,PredefinedMenuItem};
            let capture=MenuItem::with_id(app,"capture","New idea",true,None::<&str>)?;
            let library=MenuItem::with_id(app,"library","Open idea library",true,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","Quit Pocket",true,None::<&str>)?;
            let separator=PredefinedMenuItem::separator(app)?;
            let menu=Menu::with_items(app,&[&capture,&library,&separator,&quit])?;
            let tray=tauri::tray::TrayIconBuilder::new().tooltip("Pocket").menu(&menu).show_menu_on_left_click(true).icon_as_template(true);
            let icon=tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            tray.icon(icon).on_menu_event(|app,event|match event.id.as_ref(){"capture"=>request_capture(app),"library"=>{let _=request_library(app);},"quit"=>request_quit(app),_=>{}}).build(app)?;
            if !std::env::args().any(|a|a=="--background") {request_library(app.handle())?;}
            Ok(())
        })
        .on_window_event(|window,event| match event {
            tauri::WindowEvent::CloseRequested{api,..}=> {api.prevent_close();if window.label()=="library" {let _=set_recording(window.app_handle(),false);}let _=window.emit("request-close",());},
            tauri::WindowEvent::Focused(false) if window.label()=="library"=> {let _=set_recording(window.app_handle(),false);},
            tauri::WindowEvent::Focused(false) if window.label()=="capture"=> {let _=window.emit("capture-blurred",());},
            _=>{},
        })
        .build(tauri::generate_context!()).expect("Could not start Pocket");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Runtime>().exiting.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(app);
            }
        }
    });
}
