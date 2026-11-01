//! Tauri commands of the recorder. Results arrive as events: `recording_state`,
//! `recording_finished`, `recording_failed` (see `recorder`).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use super::recorder::{self, StartOptions, StopReason};
use super::recovery::UnfinishedRecording;
use super::session::RecordingStatePayload;

fn text(e: eyre::Report) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub async fn recording_start(app: AppHandle, options: StartOptions) -> Result<(), String> {
    recorder::start(&app, options).map_err(text)
}

#[tauri::command]
pub async fn recording_pause(app: AppHandle) -> Result<(), String> {
    recorder::pause(&app).map_err(text)
}

#[tauri::command]
pub async fn recording_resume(app: AppHandle) -> Result<(), String> {
    recorder::resume(&app).map_err(text)
}

#[tauri::command]
pub async fn recording_stop(app: AppHandle) -> Result<(), String> {
    recorder::stop(&app, None, StopReason::User, None).map_err(text)
}

/// Name of the folder next to the projects where recordings and their working folders live.
const RECORDINGS_FOLDER: &str = "Записи";

/// Recovery works only inside a `Записи` folder, on session folders.
fn inside_recordings(dir: &Path) -> Result<(), String> {
    let ok = dir
        .parent()
        .and_then(|p| p.file_name())
        .is_some_and(|n| n.to_string_lossy() == RECORDINGS_FOLDER);
    if ok {
        Ok(())
    } else {
        Err(format!("{} is not inside a {RECORDINGS_FOLDER} folder", dir.display()))
    }
}

/// Unfinished recordings (crash leftovers) in `<projects>/Записи`, newest first.
#[tauri::command]
pub async fn recordings_unfinished(app: AppHandle, recordings_dir: String) -> Result<Vec<UnfinishedRecording>, String> {
    tauri::async_runtime::spawn_blocking(move || recorder::unfinished(&app, Path::new(&recordings_dir)))
        .await
        .map_err(|e| e.to_string())
}

/// "Восстановить": saves the recording like a normal stop and sends `recording_finished`
/// with `recovered: true`. Returns when the file is saved.
#[tauri::command]
pub async fn recording_recover(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    inside_recordings(&dir)?;
    tauri::async_runtime::spawn_blocking(move || recorder::recover(&app, &dir).map_err(text))
        .await
        .map_err(|e| e.to_string())?
}

/// "Удалить": removes the working folder of an unfinished recording.
#[tauri::command]
pub async fn recording_discard(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    inside_recordings(&dir)?;
    tauri::async_runtime::spawn_blocking(move || recorder::discard(&app, &dir).map_err(text))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recording_state(app: AppHandle) -> Result<Option<RecordingStatePayload>, String> {
    Ok(recorder::state(&app))
}

/// What this build can capture. Video comes with the capture of Task 11 (Windows) and 14 (macOS).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSupport {
    pub video: bool,
    /// The recording pill is left out of the picture by the capture itself.
    pub pill_excluded: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowTarget {
    pub id: String,
    pub title: String,
    pub app_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct CaptureTargets {
    pub monitors: Vec<MonitorInfo>,
    pub windows: Vec<WindowTarget>,
}

fn capture_support() -> CaptureSupport {
    CaptureSupport {
        video: false,
        pill_excluded: false,
    }
}

/// Stub until the platform capture arrives (Task 11 and 14): no video yet.
#[tauri::command]
pub async fn screen_capture_support() -> Result<CaptureSupport, String> {
    Ok(capture_support())
}

/// Stub until the platform capture arrives (Task 11 and 14): nothing to list yet.
#[tauri::command]
pub async fn list_capture_targets() -> Result<CaptureTargets, String> {
    Ok(CaptureTargets::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stubs_say_no_video_and_no_targets() {
        assert!(!capture_support().video);
        assert_eq!(
            serde_json::to_value(capture_support()).unwrap(),
            serde_json::json!({ "video": false, "pillExcluded": false })
        );
        assert!(CaptureTargets::default().monitors.is_empty());
        assert!(CaptureTargets::default().windows.is_empty());
    }
}
