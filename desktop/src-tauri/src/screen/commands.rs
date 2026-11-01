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

/// Blocking: video mode picks the encoder first (probe runs of a few seconds).
#[tauri::command]
pub async fn recording_start(app: AppHandle, options: StartOptions) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || recorder::start(&app, options).map_err(text))
        .await
        .map_err(|e| e.to_string())?
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

/// What this build can capture. Video on Windows; macOS comes with Task 14.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSupport {
    pub video: bool,
    /// The recording pill is left out of the picture by the capture itself.
    pub pill_excluded: bool,
}

// Built by the Windows capture; the macOS one comes with Task 14.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
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

/// Video needs the OS floor, Windows.Graphics.Capture and a bundled ffmpeg that
/// lists an H.264 encoder for this platform. Blocking (`ffmpeg -encoders`).
#[cfg(windows)]
fn capture_support() -> CaptureSupport {
    use super::encoder::{bundled_ffmpeg, candidates, listed_encoders, TargetOs};
    use super::targets::{video_supported, windows_build};
    let build = windows_build();
    let os_ok = build.is_none_or(|b| video_supported(TargetOs::Windows, (10, 0, b)));
    let encoder_ok = || bundled_ffmpeg().is_some_and(|ff| !candidates(&listed_encoders(&ff), TargetOs::Windows).is_empty());
    let video = os_ok && super::capture::capture_api_supported() && encoder_ok();
    if !video {
        tracing::info!("video recording is not available (build {build:?})");
    }
    CaptureSupport {
        video,
        pill_excluded: build.is_none_or(|b| b >= super::pill::EXCLUDE_FROM_CAPTURE_BUILD),
    }
}

#[cfg(not(windows))]
fn capture_support() -> CaptureSupport {
    CaptureSupport {
        video: false,
        pill_excluded: false,
    }
}

#[cfg(windows)]
fn capture_targets() -> CaptureTargets {
    let monitors = super::capture::list_monitors().unwrap_or_else(|e| {
        tracing::warn!("{e:#}");
        Vec::new()
    });
    let windows = super::targets::filter_windows(meeting_detect::visible_windows(), std::process::id());
    CaptureTargets { monitors, windows }
}

#[cfg(not(windows))]
fn capture_targets() -> CaptureTargets {
    CaptureTargets::default()
}

#[tauri::command]
pub async fn screen_capture_support() -> Result<CaptureSupport, String> {
    tauri::async_runtime::spawn_blocking(capture_support)
        .await
        .map_err(|e| e.to_string())
}

/// Monitors and windows to record (never Tyto's own windows).
#[tauri::command]
pub async fn list_capture_targets() -> Result<CaptureTargets, String> {
    tauri::async_runtime::spawn_blocking(capture_targets)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_and_targets_serialize_for_the_frontend() {
        assert_eq!(
            serde_json::to_value(CaptureSupport {
                video: true,
                pill_excluded: false
            })
            .unwrap(),
            serde_json::json!({ "video": true, "pillExcluded": false })
        );
        let t = CaptureTargets {
            monitors: vec![MonitorInfo {
                id: "0".into(),
                name: "1".into(),
                width: 1920,
                height: 1080,
                primary: true,
            }],
            windows: vec![WindowTarget {
                id: "42".into(),
                title: "Телемост".into(),
                app_name: "browser".into(),
            }],
        };
        let v = serde_json::to_value(t).unwrap();
        assert_eq!(v["windows"][0]["appName"], "browser");
        assert_eq!(v["monitors"][0]["primary"], true);
    }

    #[test]
    fn own_windows_are_never_listed() {
        let own = std::process::id();
        assert!(capture_targets().windows.iter().all(|w| {
            meeting_detect::visible_windows()
                .iter()
                .find(|v| v.id.to_string() == w.id)
                .is_none_or(|v| v.pid != own)
        }));
    }
}
