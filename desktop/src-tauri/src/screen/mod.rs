pub mod audio_sink;
pub mod commands;
pub mod disk;
pub mod encoder;
pub mod frame;
pub mod pacer;
pub mod pill;
pub mod quality;
pub mod recorder;
pub mod recovery;
pub mod segments;
pub mod session;
pub mod targets;
#[cfg(windows)]
pub mod video_win;
pub mod video_writer;

/// The platform capture behind one interface for the recorder.
#[cfg(windows)]
pub use video_win as capture;

/// No video capture on this platform yet (macOS comes with Task 14).
#[cfg(not(windows))]
pub mod capture {
    use eyre::{bail, Result};

    use super::frame::LatestFrame;
    use super::recorder::CaptureTarget;

    // Constructed by the macOS capture (Task 14).
    #[allow(dead_code)]
    pub struct CaptureHandle;

    impl CaptureHandle {
        pub fn stop(self) {}
    }

    pub fn source_size(_target: &CaptureTarget) -> Result<(u32, u32)> {
        bail!("video capture is not available on this platform")
    }

    pub fn start_capture(
        _target: &CaptureTarget,
        _out_size: (u32, u32),
        _latest: LatestFrame,
        _fps: u32,
    ) -> Result<CaptureHandle> {
        bail!("video capture is not available on this platform")
    }
}
