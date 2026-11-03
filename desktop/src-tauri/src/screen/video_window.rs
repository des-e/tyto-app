//! The video of a project in its own window, on top of other apps (Денис, 2026-11-02): it can go
//! to a second monitor or next to the call. A page element cannot move between windows, so the
//! window plays its own muted copy and follows the main player (`video-sync` events from the main
//! window); the sound stays in the main window. The window-state plugin keeps its place and size.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const WINDOW_LABEL: &str = "video-window";
/// Told to the main window when the user closes the video window.
const CLOSED_EVENT: &str = "video-window-closed";
/// Told to the video window when another project's video replaces the one it shows.
const SOURCE_EVENT: &str = "video-window-source";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSource {
    pub path: String,
    pub title: String,
}

#[derive(Default)]
pub struct VideoWindowState(Mutex<Option<VideoSource>>);

impl VideoWindowState {
    fn set(&self, source: Option<VideoSource>) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = source;
    }

    fn get(&self) -> Option<VideoSource> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

fn window_title(title: &str) -> String {
    if title.trim().is_empty() {
        "Tyto".into()
    } else {
        format!("{title} · Tyto")
    }
}

/// Opens the window for `path`, or points the open one at it. Async: building a window in a
/// synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn video_window_open(app: AppHandle, path: String, title: String) -> Result<(), String> {
    let source = VideoSource { path, title };
    app.state::<VideoWindowState>().set(Some(source.clone()));
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.set_title(&window_title(&source.title));
        window.emit(SOURCE_EVENT, &source).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html?window=video".into()))
        .title(window_title(&source.title))
        .inner_size(480.0, 270.0)
        .min_inner_size(240.0, 135.0)
        .always_on_top(true)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(state) = handle.try_state::<VideoWindowState>() {
                state.set(None);
            }
            let _ = handle.emit(CLOSED_EVENT, ());
        }
    });
    Ok(())
}

/// The video the window shows (read once when its page loads).
#[tauri::command]
pub fn video_window_source(state: State<'_, VideoWindowState>) -> Option<VideoSource> {
    state.get()
}

#[tauri::command]
pub async fn video_window_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_names_the_project_and_the_app() {
        assert_eq!(window_title("Планерка"), "Планерка · Tyto");
        assert_eq!(window_title("  "), "Tyto");
    }

    #[test]
    fn source_serializes_for_the_window() {
        let source = VideoSource {
            path: "C:/Записи/Встреча.mp4".into(),
            title: "Встреча".into(),
        };
        assert_eq!(
            serde_json::to_value(&source).unwrap(),
            serde_json::json!({ "path": "C:/Записи/Встреча.mp4", "title": "Встреча" })
        );
        let state = VideoWindowState::default();
        state.set(Some(source.clone()));
        assert_eq!(state.get(), Some(source));
    }
}
