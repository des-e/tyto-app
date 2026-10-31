//! Tauri commands of the recorder. Results arrive as events: `recording_state`,
//! `recording_finished`, `recording_failed` (see `recorder`).

use tauri::AppHandle;

use super::recorder::{self, StartOptions, StopReason};
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
    recorder::stop(&app, None, StopReason::User).map_err(text)
}

#[tauri::command]
pub fn recording_state(app: AppHandle) -> Result<Option<RecordingStatePayload>, String> {
    Ok(recorder::state(&app))
}
