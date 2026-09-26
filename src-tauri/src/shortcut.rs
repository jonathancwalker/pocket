#[derive(Default)]
pub struct ShortcutTaps {
    held: bool,
    first: Option<std::time::Instant>,
}
#[derive(Debug, PartialEq)]
pub enum Doorway {
    Capture,
    Library,
}
impl ShortcutTaps {
    pub fn event(&mut self, pressed: bool, now: std::time::Instant) -> Option<Doorway> {
        if !pressed {
            self.held = false;
            return None;
        }
        if self.held {
            return None;
        }
        self.held = true;
        if self
            .first
            .take()
            .is_some_and(|t| now.saturating_duration_since(t).as_millis() <= 450)
        {
            Some(Doorway::Library)
        } else {
            self.first = Some(now);
            Some(Doorway::Capture)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    #[test]
    fn repeat_is_not_a_second_tap_and_key_release_rearms() {
        let mut taps = ShortcutTaps::default();
        let now = Instant::now();
        assert_eq!(taps.event(true, now), Some(Doorway::Capture));
        assert_eq!(taps.event(true, now + Duration::from_millis(80)), None);
        taps.event(false, now + Duration::from_millis(90));
        assert_eq!(
            taps.event(true, now + Duration::from_millis(200)),
            Some(Doorway::Library)
        );
        taps.event(false, now + Duration::from_millis(220));
        assert_eq!(
            taps.event(true, now + Duration::from_millis(300)),
            Some(Doorway::Capture)
        );
    }
    #[test]
    fn a_later_press_starts_a_new_pair() {
        let mut taps = ShortcutTaps::default();
        let now = Instant::now();
        taps.event(true, now);
        taps.event(false, now);
        assert_eq!(
            taps.event(true, now + Duration::from_millis(451)),
            Some(Doorway::Capture)
        );
    }
}
