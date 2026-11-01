//! Screen and window capture on Windows (Windows.Graphics.Capture via `windows-capture`).
//!
//! Every frame is scaled into the session size right here (`resize_into`), so a
//! 4K screen never sends 4K frames through the ffmpeg pipe, and a window that
//! changes its size is letterboxed into the size it had at the start.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use eyre::{bail, eyre, Context, ContextCompat, Result};
use windows_capture::capture::{CaptureControl, Context as CaptureContext, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame as CapturedFrame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, GraphicsCaptureItemType,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use super::commands::MonitorInfo;
use super::frame::{resize_into, Frame, LatestFrame};
use super::recorder::CaptureTarget;

/// Whether Windows.Graphics.Capture works on this PC.
pub fn capture_api_supported() -> bool {
    GraphicsCaptureApi::is_supported().unwrap_or(false)
}

fn monitor_by_id(id: &str) -> Result<Monitor> {
    let index: usize = id.parse().with_context(|| format!("bad monitor id {id}"))?;
    let monitors = Monitor::enumerate().map_err(|e| eyre!("list monitors: {e}"))?;
    monitors.get(index).copied().with_context(|| format!("monitor {id} is gone"))
}

fn window_by_id(id: &str) -> Result<Window> {
    let hwnd: u64 = id.parse().with_context(|| format!("bad window id {id}"))?;
    Ok(Window::from_raw_hwnd(hwnd as usize as *mut c_void))
}

/// Monitors in `EnumDisplayMonitors` order; `id` is the index in that list.
pub fn list_monitors() -> Result<Vec<MonitorInfo>> {
    let monitors = Monitor::enumerate().map_err(|e| eyre!("list monitors: {e}"))?;
    let primary = Monitor::primary().ok();
    Ok(monitors
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let (width, height) = (m.width().ok()?, m.height().ok()?);
            Some(MonitorInfo {
                id: i.to_string(),
                name: m
                    .name()
                    .ok()
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| (i + 1).to_string()),
                width,
                height,
                primary: primary == Some(*m),
            })
        })
        .collect())
}

/// Size of the picture the capture delivers, in physical pixels.
pub fn source_size(target: &CaptureTarget) -> Result<(u32, u32)> {
    let item: Result<GraphicsCaptureItemType, windows::core::Error> = match target {
        CaptureTarget::Monitor { id } => TryInto::<GraphicsCaptureItemType>::try_into(monitor_by_id(id)?),
        CaptureTarget::Window { id } => TryInto::<GraphicsCaptureItemType>::try_into(window_by_id(id)?),
    };
    let item = match item.map_err(|e| eyre!("capture item: {e}"))? {
        GraphicsCaptureItemType::Monitor((item, _)) => item,
        GraphicsCaptureItemType::Window((item, _)) => item,
        GraphicsCaptureItemType::Unknown((item, _)) => item,
    };
    let size = item.Size().map_err(|e| eyre!("capture size: {e}"))?;
    let (w, h) = (
        u32::try_from(size.Width).unwrap_or(0),
        u32::try_from(size.Height).unwrap_or(0),
    );
    if w < 2 || h < 2 {
        bail!("the window is minimized or has no size");
    }
    Ok((w, h))
}

struct Flags {
    latest: LatestFrame,
    size: (u32, u32),
    /// Frames closer than this are dropped here (no `MinUpdateInterval` before Windows 11).
    min_gap: Option<Duration>,
}

struct Handler {
    latest: LatestFrame,
    scratch: Frame,
    min_gap: Option<Duration>,
    last: Option<Instant>,
    buffer_warned: bool,
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = Flags;
    type Error = String;

    fn new(ctx: CaptureContext<Self::Flags>) -> Result<Self, Self::Error> {
        let f = ctx.flags;
        Ok(Self {
            latest: f.latest,
            scratch: Frame::black(f.size.0, f.size.1),
            min_gap: f.min_gap,
            last: None,
            buffer_warned: false,
        })
    }

    fn on_frame_arrived(&mut self, frame: &mut CapturedFrame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        let now = Instant::now();
        if let (Some(gap), Some(last)) = (self.min_gap, self.last) {
            if now.saturating_duration_since(last) < gap {
                return Ok(());
            }
        }
        self.last = Some(now);
        let (w, h) = (frame.width(), frame.height());
        let mut buffer = match frame.buffer() {
            Ok(b) => b,
            Err(e) => {
                // One bad frame must not end the capture: the last good one stays.
                if !self.buffer_warned {
                    self.buffer_warned = true;
                    tracing::warn!("reading a captured frame failed: {e}");
                }
                return Ok(());
            }
        };
        let stride = buffer.row_pitch();
        resize_into(buffer.as_raw_buffer(), w, h, stride, &mut self.scratch);
        let mut latest = self.latest.lock().unwrap_or_else(|p| p.into_inner());
        match latest.as_mut() {
            // Swap: the old picture's memory is reused for the next frame.
            Some(current) => std::mem::swap(current, &mut self.scratch),
            None => *latest = Some(self.scratch.clone()),
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // The window was closed: the video keeps its last frame, the sound goes on.
        tracing::info!("the captured window was closed, keeping the last frame");
        Ok(())
    }
}

/// A running capture; `stop` ends it (it also ends by itself when the window closes).
pub struct CaptureHandle {
    control: Option<CaptureControl<Handler, String>>,
}

impl CaptureHandle {
    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        if let Some(control) = self.control.take() {
            if let Err(e) = control.stop() {
                tracing::warn!("stopping the capture: {e}");
            }
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

/// Starts capturing `target`; every frame is scaled into `out_size` and put into `latest`.
pub fn start_capture(target: &CaptureTarget, out_size: (u32, u32), latest: LatestFrame, fps: u32) -> Result<CaptureHandle> {
    let gap = Duration::from_nanos(1_000_000_000 / u64::from(fps.max(1)));
    // Windows 11 lets the OS deliver at most `fps` frames: nothing is lost. Older
    // builds deliver every change; frames closer than half a frame are skipped.
    let os_interval = GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false);
    let flags = Flags {
        latest,
        size: out_size,
        min_gap: (!os_interval).then_some(gap / 2),
    };
    let control = match target {
        CaptureTarget::Monitor { id } => start_with_interval(monitor_by_id(id)?, flags, os_interval.then_some(gap))?,
        CaptureTarget::Window { id } => start_with_interval(window_by_id(id)?, flags, os_interval.then_some(gap))?,
    };
    Ok(CaptureHandle { control: Some(control) })
}

fn start_with_interval<T>(item: T, flags: Flags, interval: Option<Duration>) -> Result<CaptureControl<Handler, String>>
where
    T: TryInto<GraphicsCaptureItemType> + Send + 'static,
{
    let interval = interval.map_or(MinimumUpdateIntervalSettings::Default, MinimumUpdateIntervalSettings::Custom);
    let settings = Settings::new(
        item,
        CursorCaptureSettings::Default,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        interval,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );
    Handler::start_free_threaded(settings).map_err(|e| eyre!("start the capture: {e}"))
}
