use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Audio,
    Video,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Recording,
    Paused,
    Finishing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Start,
    Pause,
    Resume,
    Stop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionError {
    AlreadyRecording,
    NotRecording,
    AlreadyPaused,
    NotPaused,
    Finishing,
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            SessionError::AlreadyRecording => "recording is already in progress",
            SessionError::NotRecording => "no recording in progress",
            SessionError::AlreadyPaused => "recording is already paused",
            SessionError::NotPaused => "recording is not paused",
            SessionError::Finishing => "recording is being finished",
        };
        f.write_str(text)
    }
}

impl std::error::Error for SessionError {}

pub fn transition(current: Option<Status>, cmd: Command) -> Result<Option<Status>, SessionError> {
    use Command::*;
    use Status::*;
    match (current, cmd) {
        (Some(Finishing), _) => Err(SessionError::Finishing),
        (None, Start) => Ok(Some(Recording)),
        (Some(_), Start) => Err(SessionError::AlreadyRecording),
        (None, _) => Err(SessionError::NotRecording),
        (Some(Recording), Pause) => Ok(Some(Paused)),
        (Some(Paused), Pause) => Err(SessionError::AlreadyPaused),
        (Some(Paused), Resume) => Ok(Some(Recording)),
        (Some(Recording), Resume) => Err(SessionError::NotPaused),
        (Some(Recording | Paused), Stop) => Ok(Some(Finishing)),
    }
}

/// Recording clock that does not count paused time.
#[derive(Clone, Copy, Debug, Default)]
pub struct Timeline {
    accumulated_ms: u64,
    running_since: Option<u64>,
}

impl Timeline {
    pub fn start(&mut self, now_ms: u64) {
        self.accumulated_ms = 0;
        self.running_since = Some(now_ms);
    }

    pub fn pause(&mut self, now_ms: u64) {
        if let Some(since) = self.running_since.take() {
            self.accumulated_ms += now_ms.saturating_sub(since);
        }
    }

    pub fn resume(&mut self, now_ms: u64) {
        if self.running_since.is_none() {
            self.running_since = Some(now_ms);
        }
    }

    pub fn active_ms(&self, now_ms: u64) -> u64 {
        self.accumulated_ms + self.running_since.map_or(0, |since| now_ms.saturating_sub(since))
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatePayload {
    pub status: Status,
    pub mode: Mode,
    pub active_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_start_is_rejected_while_recording_or_paused() {
        assert_eq!(
            transition(Some(Status::Recording), Command::Start),
            Err(SessionError::AlreadyRecording)
        );
        assert_eq!(
            transition(Some(Status::Paused), Command::Start),
            Err(SessionError::AlreadyRecording)
        );
        assert_eq!(
            transition(Some(Status::Finishing), Command::Pause),
            Err(SessionError::Finishing)
        );
        assert_eq!(transition(Some(Status::Paused), Command::Stop), Ok(Some(Status::Finishing)));
    }

    #[test]
    fn normal_flow_and_invalid_commands() {
        assert_eq!(transition(None, Command::Start), Ok(Some(Status::Recording)));
        assert_eq!(transition(Some(Status::Recording), Command::Pause), Ok(Some(Status::Paused)));
        assert_eq!(transition(Some(Status::Paused), Command::Resume), Ok(Some(Status::Recording)));
        assert_eq!(
            transition(Some(Status::Paused), Command::Pause),
            Err(SessionError::AlreadyPaused)
        );
        assert_eq!(
            transition(Some(Status::Recording), Command::Resume),
            Err(SessionError::NotPaused)
        );
        assert_eq!(transition(None, Command::Stop), Err(SessionError::NotRecording));
    }

    #[test]
    fn paused_time_is_not_counted() {
        let mut t = Timeline::default();
        t.start(0);
        t.pause(10_000);
        t.resume(70_000);
        assert_eq!(t.active_ms(75_000), 15_000);
        t.pause(80_000);
        assert_eq!(t.active_ms(500_000), 20_000);
    }
}
