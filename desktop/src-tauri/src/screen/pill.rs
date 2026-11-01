//! The floating recording pill: owl, blinking red dot, timer, «Пауза» and «Стоп».
//!
//! Shown without focus for every recording (audio and video); the main window is
//! minimized meanwhile and comes back when the recording is saved or failed.
//! The pill never gets into a capture; the main window and the meeting prompt
//! are excluded only while recording (otherwise Tyto would vanish from a Zoom
//! screen share). The position is remembered in the store.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_store::StoreExt;

use super::recorder;
use super::session::RecordingStatePayload;
use crate::config::STORE_FILENAME;

#[cfg(target_os = "macos")]
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(RecordingPillPanel {
        config: {
            // Same as `MeetingPromptPanel`: key-capable so WebKit routes clicks to the
            // buttons, nonactivating so Tyto never takes the focus from the meeting.
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
            becomes_key_only_if_needed: true,
            hides_on_deactivate: false
        }
    })
}

pub const WINDOW_LABEL: &str = "recording-pill";
const MAIN_LABEL: &str = "main";
const MEETING_PROMPT_LABEL: &str = "meeting-prompt";
const POSITION_KEY: &str = "recording.pillPosition";
const STATE_EVENT: &str = "recording_state";
const WIDTH: f64 = 264.0;
const HEIGHT: f64 = 52.0;
/// Gap above the pill at the top center of a monitor, physical pixels.
const TOP_MARGIN: i32 = 12;
/// `WindowEvent::Moved` comes on every pixel of a drag: the store is written at most this often.
const SAVE_EVERY: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl MonitorRect {
    fn contains(&self, x: i32, y: i32, size: (u32, u32)) -> bool {
        let (x, y) = (i64::from(x), i64::from(y));
        let (left, top) = (i64::from(self.x), i64::from(self.y));
        x >= left
            && y >= top
            && x + i64::from(size.0) <= left + i64::from(self.w)
            && y + i64::from(size.1) <= top + i64::from(self.h)
    }
}

/// The saved position while the whole pill fits on a connected monitor; otherwise
/// (no position yet, or that monitor was unplugged) top center of `cursor_monitor`.
pub fn restore_position(
    saved: Option<(i32, i32)>,
    size: (u32, u32),
    monitors: &[MonitorRect],
    cursor_monitor: &MonitorRect,
) -> (i32, i32) {
    if let Some((x, y)) = saved {
        if monitors.iter().any(|m| m.contains(x, y, size)) {
            return (x, y);
        }
    }
    let x = i64::from(cursor_monitor.x) + (i64::from(cursor_monitor.w) - i64::from(size.0)) / 2;
    (x as i32, cursor_monitor.y + TOP_MARGIN)
}

/// Keep `window` out of screenshots and screen captures (`exclude = false` gives it back).
/// Windows 10 below 2004 (build 19041) has no such mode: a warning in the log, the
/// recording goes on (the pill may then get into a full-screen video).
pub fn exclude_from_capture(window: &WebviewWindow, exclude: bool) {
    #[cfg(windows)]
    {
        if exclude && !windows_can_exclude() {
            tracing::warn!(
                "Windows below 10 2004: {} can not be excluded from screen capture",
                window.label()
            );
            return;
        }
        let target = window.clone();
        let run = window.run_on_main_thread(move || {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
            let hwnd = match target.hwnd() {
                Ok(hwnd) => HWND(hwnd.0),
                Err(e) => {
                    tracing::warn!("no window handle for {}: {e}", target.label());
                    return;
                }
            };
            let affinity = if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
            // SAFETY: a live top-level window of this process, on its UI thread.
            if let Err(e) = unsafe { SetWindowDisplayAffinity(hwnd, affinity) } {
                tracing::warn!("SetWindowDisplayAffinity({}, {exclude}) failed: {e}", target.label());
            }
        });
        if let Err(e) = run {
            tracing::warn!("exclude_from_capture: {e}");
        }
    }
    #[cfg(target_os = "macos")]
    {
        // TODO(Task 14): ScreenCaptureKit ignores `sharingType` on macOS 15; the windows are
        // excluded from the capture there by the `SCContentFilter` window list.
        let target = window.clone();
        let run = window.run_on_main_thread(move || {
            use objc2_app_kit::{NSWindow, NSWindowSharingType};
            let Ok(ptr) = target.ns_window() else {
                return;
            };
            let sharing = if exclude {
                NSWindowSharingType::None
            } else {
                NSWindowSharingType::ReadOnly
            };
            // SAFETY: the NSWindow of a live Tauri window, on the main thread.
            unsafe {
                let native: &NSWindow = &*ptr.cast();
                native.setSharingType(sharing);
            }
        });
        if let Err(e) = run {
            tracing::warn!("exclude_from_capture: {e}");
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (window, exclude);
    }
}

/// `WDA_EXCLUDEFROMCAPTURE` is there from build 19041; earlier builds treat it as
/// `WDA_MONITOR` (a black box in every share), so it is not set there at all.
#[cfg(windows)]
fn windows_can_exclude() -> bool {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let build = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .and_then(|key| key.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|build| build.trim().parse::<u32>().ok());
    // Unknown build: try; a failing call only logs.
    build.is_none_or(|build| build >= 19041)
}

/// Writes the last position of a drag at most once per `SAVE_EVERY`.
#[derive(Default)]
struct PositionSaver {
    pending: Mutex<Option<(i32, i32)>>,
    scheduled: AtomicBool,
}

impl PositionSaver {
    fn moved(self: &Arc<Self>, app: &AppHandle, position: (i32, i32)) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(position);
        }
        if self.scheduled.swap(true, Ordering::SeqCst) {
            return;
        }
        let saver = Arc::clone(self);
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SAVE_EVERY);
            // Cleared first: a move after this point schedules the next write.
            saver.scheduled.store(false, Ordering::SeqCst);
            let position = saver.pending.lock().ok().and_then(|mut pending| pending.take());
            if let Some(position) = position {
                write_position(&app, position);
            }
        });
    }
}

fn write_position(app: &AppHandle, (x, y): (i32, i32)) {
    match app.store(STORE_FILENAME) {
        Ok(store) => {
            store.set(POSITION_KEY, serde_json::json!([x, y]));
            if let Err(e) = store.save() {
                tracing::warn!("saving the pill position: {e}");
            }
        }
        Err(e) => tracing::warn!("store for the pill position: {e}"),
    }
}

fn read_position(app: &AppHandle) -> Option<(i32, i32)> {
    let value = app.store(STORE_FILENAME).ok()?.get(POSITION_KEY)?;
    let pair = value.as_array()?;
    let x = i32::try_from(pair.first()?.as_i64()?).ok()?;
    let y = i32::try_from(pair.get(1)?.as_i64()?).ok()?;
    Some((x, y))
}

fn rect(monitor: &tauri::Monitor) -> MonitorRect {
    let (position, size) = (monitor.position(), monitor.size());
    MonitorRect {
        x: position.x,
        y: position.y,
        w: size.width,
        h: size.height,
    }
}

fn create_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html?window=recording-pill".into()))
        .title("Tyto")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .focusable(false)
        // A click on «Стоп» must work at once, even while the meeting app is active.
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    window
        .set_size(LogicalSize::new(WIDTH, HEIGHT))
        .map_err(|error| error.to_string())?;

    let saver = Arc::new(PositionSaver::default());
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(position) = event {
            saver.moved(&handle, (position.x, position.y));
        }
    });

    #[cfg(target_os = "macos")]
    {
        let panel = window.to_panel::<RecordingPillPanel>().map_err(|error| error.to_string())?;
        panel.set_level(PanelLevel::Floating.value());
        panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().into());
        panel.set_hides_on_deactivate(false);
        panel.set_works_when_modal(true);
        panel.set_transparent(true);
    }

    // Always: the pill is never part of a recording.
    exclude_from_capture(&window, true);
    Ok(window)
}

fn position_window(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let monitors: Vec<MonitorRect> = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(rect)
        .collect();
    let cursor_monitor = window
        .cursor_position()
        .ok()
        .and_then(|cursor| window.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| rect(&monitor))
        .or_else(|| monitors.first().copied());
    let Some(cursor_monitor) = cursor_monitor else {
        return Ok(());
    };
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let (x, y) = restore_position(read_position(app), (size.width, size.height), &monitors, &cursor_monitor);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn show_without_focus(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let _ = window;
    let panel = app
        .get_webview_panel(WINDOW_LABEL)
        .map_err(|_| "recording pill panel is not initialized".to_string())?;
    app.run_on_main_thread(move || panel.order_front_regardless())
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn show_without_focus(_app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

/// At launch, on the main thread (the mac panel is made there, as the meeting prompt's is): the
/// pill waits hidden with its page loaded, so it shows at once when a recording starts.
pub fn initialize(app: &AppHandle) {
    if app.get_webview_window(WINDOW_LABEL).is_none() {
        if let Err(e) = create_window(app) {
            tracing::error!("could not create the recording pill: {e}");
        }
    }
}

fn show(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(WINDOW_LABEL) {
        Some(window) => window,
        // Only if the launch-time creation failed. Not on mac: the panel needs the main thread.
        #[cfg(not(target_os = "macos"))]
        None => create_window(app)?,
        #[cfg(target_os = "macos")]
        None => return Err("the recording pill was not created at launch".into()),
    };
    if let Err(e) = position_window(app, &window) {
        tracing::warn!("positioning the recording pill: {e}");
    }
    show_without_focus(app, &window)
}

/// Any recording started (panel, shortcut, meeting prompt): pill on, Tyto out of the way.
pub fn recording_started(app: &AppHandle) {
    if let Err(e) = show(app) {
        tracing::error!("could not show the recording pill: {e}");
    }
    if let Some(prompt) = app.get_webview_window(MEETING_PROMPT_LABEL) {
        exclude_from_capture(&prompt, true);
    }
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        exclude_from_capture(&main, true);
        // A window hidden in the tray stays there: minimizing would bring it up on Windows.
        if main.is_visible().unwrap_or(false) {
            if let Err(e) = main.minimize() {
                tracing::warn!("minimizing the main window: {e}");
            }
        }
    }
}

/// `recording_finished` / `recording_failed`: pill off, Tyto back with the result.
pub fn recording_ended(app: &AppHandle) {
    if let Some(pill) = app.get_webview_window(WINDOW_LABEL) {
        if let Err(e) = pill.hide() {
            tracing::warn!("hiding the recording pill: {e}");
        }
    }
    if let Some(prompt) = app.get_webview_window(MEETING_PROMPT_LABEL) {
        exclude_from_capture(&prompt, false);
    }
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        exclude_from_capture(&main, false);
        for (what, result) in [
            ("show", main.show()),
            ("unminimize", main.unminimize()),
            ("focus", main.set_focus()),
        ] {
            if let Err(e) = result {
                tracing::warn!("main window {what}: {e}");
            }
        }
    }
}

/// The pill page loaded: it gets the current state (and the pill hides if the recording is over).
#[tauri::command]
pub fn recording_pill_ready(window: WebviewWindow) -> Result<Option<RecordingStatePayload>, String> {
    let state = recorder::state(window.app_handle());
    match state {
        Some(state) => {
            window.emit(STATE_EVENT, state).map_err(|error| error.to_string())?;
        }
        None => window.hide().map_err(|error| error.to_string())?,
    }
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_position_on_a_live_monitor_is_kept() {
        let m = [MonitorRect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        }];
        assert_eq!(restore_position(Some((100, 40)), (264, 52), &m, &m[0]), (100, 40));
    }

    #[test]
    fn position_on_a_disconnected_monitor_falls_back_to_top_center() {
        // Review Focus 5
        let m = [MonitorRect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        }];
        assert_eq!(restore_position(Some((2500, 40)), (264, 52), &m, &m[0]), (828, 12));
        assert_eq!(restore_position(None, (264, 52), &m, &m[0]), (828, 12));
    }

    #[test]
    fn a_second_monitor_on_the_left_keeps_its_negative_position() {
        let left = MonitorRect {
            x: -1280,
            y: 0,
            w: 1280,
            h: 1024,
        };
        let main = MonitorRect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        };
        let monitors = [main, left];
        assert_eq!(restore_position(Some((-600, 30)), (264, 52), &monitors, &main), (-600, 30));
        // Half on the left monitor, half off any screen: back to the top center.
        assert_eq!(restore_position(Some((-1400, 30)), (264, 52), &monitors, &main), (828, 12));
    }
}
