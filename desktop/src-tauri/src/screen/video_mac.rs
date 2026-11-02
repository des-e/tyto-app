//! Screen and window capture on macOS 13+ (ScreenCaptureKit via `screencapturekit`).
//!
//! ScreenCaptureKit scales the picture into the session size itself (`scalesToFit`
//! keeps the aspect, black bars around), so `resize_into` only drops the row
//! padding. The framework is weak-linked: nothing here touches it below macOS 13,
//! every entry point checks `video_available` first.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use eyre::{bail, eyre, Context, ContextCompat, Result};
use screencapturekit::cm::SCFrameStatus;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use screencapturekit::stream::delegate_trait::StreamCallbacks;

use super::commands::MonitorInfo;
use super::encoder::TargetOs;
use super::frame::{resize_into, Frame, LatestFrame};
use super::recorder::CaptureTarget;
use super::targets::video_supported;

/// `NSProcessInfo.operatingSystemVersion`.
pub fn macos_version() -> (u32, u32, u32) {
    let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    let part = |n: isize| u32::try_from(n).unwrap_or(0);
    (part(v.majorVersion), part(v.minorVersion), part(v.patchVersion))
}

/// macOS 13 or newer: ScreenCaptureKit may be called.
pub fn video_available() -> bool {
    video_supported(TargetOs::MacOs, macos_version())
}

fn ensure_available() -> Result<()> {
    if !video_available() {
        let (a, b, c) = macos_version();
        bail!("video capture needs macOS 13 or newer, this is {a}.{b}.{c}");
    }
    Ok(())
}

#[allow(non_snake_case)]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGDisplayCopyDisplayMode(display: u32) -> *mut std::ffi::c_void;
    fn CGDisplayModeGetPixelWidth(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeRelease(mode: *mut std::ffi::c_void);
    fn CGMainDisplayID() -> u32;
}

/// The display's size in pixels (`SCDisplay` reports points; a Retina screen has twice as many pixels).
fn display_pixels(display: &SCDisplay) -> (u32, u32) {
    let points = (display.width(), display.height());
    // SAFETY: plain CoreGraphics calls; the copied mode is released here.
    unsafe {
        let mode = CGDisplayCopyDisplayMode(display.display_id());
        if mode.is_null() {
            return points;
        }
        let px = (CGDisplayModeGetPixelWidth(mode), CGDisplayModeGetPixelHeight(mode));
        CGDisplayModeRelease(mode);
        match (u32::try_from(px.0), u32::try_from(px.1)) {
            (Ok(w), Ok(h)) if w >= 2 && h >= 2 => (w, h),
            _ => points,
        }
    }
}

/// Pixels per point of the display the window is on (by its center), else of the first one.
fn window_scale(window: &SCWindow, displays: &[SCDisplay]) -> f64 {
    let f = window.frame();
    let (cx, cy) = (f.origin.x + f.size.width / 2.0, f.origin.y + f.size.height / 2.0);
    let on = displays.iter().find(|d| {
        let r = d.frame();
        cx >= r.origin.x && cx < r.origin.x + r.size.width && cy >= r.origin.y && cy < r.origin.y + r.size.height
    });
    let Some(d) = on.or_else(|| displays.first()) else {
        return 1.0;
    };
    let (px, pt) = (display_pixels(d).0, d.width());
    if pt == 0 {
        1.0
    } else {
        (f64::from(px) / f64::from(pt)).max(1.0)
    }
}

fn content() -> Result<SCShareableContent> {
    ensure_available()?;
    // Fails without the Screen Recording permission; the UI asks for it first.
    SCShareableContent::get().map_err(|e| eyre!("list the screen content: {e}"))
}

fn display_by_id(content: &SCShareableContent, id: &str) -> Result<SCDisplay> {
    let id: u32 = id.parse().with_context(|| format!("bad display id {id}"))?;
    content
        .displays()
        .into_iter()
        .find(|d| d.display_id() == id)
        .with_context(|| format!("display {id} is gone"))
}

fn window_by_id(content: &SCShareableContent, id: &str) -> Result<SCWindow> {
    let id: u32 = id.parse().with_context(|| format!("bad window id {id}"))?;
    content
        .windows()
        .into_iter()
        .find(|w| w.window_id() == id)
        .with_context(|| format!("window {id} is gone"))
}

/// Displays in ScreenCaptureKit order; `id` is the `CGDirectDisplayID`.
pub fn list_monitors() -> Result<Vec<MonitorInfo>> {
    let content = content()?;
    // SAFETY: plain CoreGraphics call.
    let main = unsafe { CGMainDisplayID() };
    Ok(content
        .displays()
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let (width, height) = display_pixels(d);
            MonitorInfo {
                id: d.display_id().to_string(),
                name: (i + 1).to_string(),
                width,
                height,
                primary: d.display_id() == main,
            }
        })
        .collect())
}

/// Size of the picture in physical pixels.
pub fn source_size(target: &CaptureTarget) -> Result<(u32, u32)> {
    let content = content()?;
    let (w, h) = match target {
        CaptureTarget::Monitor { id } => display_pixels(&display_by_id(&content, id)?),
        CaptureTarget::Window { id } => {
            let window = window_by_id(&content, id)?;
            let scale = window_scale(&window, &content.displays());
            let f = window.frame();
            ((f.size.width * scale).round() as u32, (f.size.height * scale).round() as u32)
        }
    };
    if w < 2 || h < 2 {
        bail!("the window is minimized or has no size");
    }
    Ok((w, h))
}

/// Puts every complete frame into `latest`. An idle frame (nothing changed) carries
/// no picture: the last one stays and the writer repeats it.
struct Output {
    latest: LatestFrame,
    scratch: Mutex<Frame>,
    warned: AtomicBool,
}

impl Output {
    fn warn_once(&self, what: &str) {
        if !self.warned.swap(true, Ordering::Relaxed) {
            tracing::warn!("{what}");
        }
    }
}

impl SCStreamOutputTrait for Output {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        if !matches!(
            sample.frame_status(),
            Some(SCFrameStatus::Complete) | Some(SCFrameStatus::Started)
        ) {
            return;
        }
        let Some(pixels) = sample.pixel_buffer() else {
            return;
        };
        let Ok(guard) = pixels.lock(CVPixelBufferLockFlags::READ_ONLY) else {
            self.warn_once("locking a captured frame failed");
            return;
        };
        // SAFETY: read only while `guard` keeps the buffer locked.
        let Some(data) = (unsafe { guard.as_slice() }) else {
            self.warn_once("a captured frame has no pixel data");
            return;
        };
        let (w, h, stride) = (guard.width(), guard.height(), guard.bytes_per_row());
        let (Ok(w), Ok(h), Ok(stride)) = (u32::try_from(w), u32::try_from(h), u32::try_from(stride)) else {
            return;
        };
        let mut scratch = self.scratch.lock().unwrap_or_else(|p| p.into_inner());
        resize_into(data, w, h, stride, &mut scratch);
        let mut latest = self.latest.lock().unwrap_or_else(|p| p.into_inner());
        match latest.as_mut() {
            // Swap: the old picture's memory is reused for the next frame.
            Some(current) => std::mem::swap(current, &mut scratch),
            None => *latest = Some(scratch.clone()),
        }
    }
}

/// A running capture; `stop` ends it.
pub struct CaptureHandle {
    stream: Option<SCStream>,
}

impl CaptureHandle {
    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        if let Some(stream) = self.stream.take() {
            if let Err(e) = stream.stop_capture() {
                // Already stopped (the window was closed): nothing to do.
                tracing::debug!("stopping the capture: {e}");
            }
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

/// The filter: one window, or the whole display without any window of Tyto
/// (main window, recording pill, meeting prompt; also ones that open later).
fn filter_for(content: &SCShareableContent, target: &CaptureTarget) -> Result<SCContentFilter> {
    let builder = match target {
        CaptureTarget::Window { id } => SCContentFilter::create().with_window(&window_by_id(content, id)?),
        CaptureTarget::Monitor { id } => {
            let display = display_by_id(content, id)?;
            let own = i64::from(std::process::id());
            let apps = content.applications();
            match apps.iter().find(|a| i64::from(a.process_id()) == own) {
                Some(app) => SCContentFilter::create()
                    .with_display(&display)
                    .with_excluding_applications(&[app], &[]),
                None => {
                    // Not listed (no window on screen yet): leave out the windows it has.
                    let windows = content.windows();
                    let mine: Vec<&SCWindow> = windows
                        .iter()
                        .filter(|w| w.owning_application().is_some_and(|a| i64::from(a.process_id()) == own))
                        .collect();
                    tracing::warn!("Tyto is not in the shareable apps, excluding {} of its windows", mine.len());
                    SCContentFilter::create().with_display(&display).with_excluding_windows(&mine)
                }
            }
        }
    };
    builder.build().map_err(|e| eyre!("capture filter: {e}"))
}

/// Starts capturing `target` at `out_size` and `fps`; frames go into `latest`.
pub fn start_capture(target: &CaptureTarget, out_size: (u32, u32), latest: LatestFrame, fps: u32) -> Result<CaptureHandle> {
    let content = content()?;
    let filter = filter_for(&content, target)?;
    let config = SCStreamConfiguration::new()
        .with_width(out_size.0)
        .with_height(out_size.1)
        .with_scales_to_fit(true)
        .with_pixel_format(PixelFormat::BGRA)
        .with_fps(fps.max(1))
        .with_shows_cursor(true)
        .with_queue_depth(5);
    let callbacks = StreamCallbacks::new().on_stop(|error| match error {
        // The window was closed: the video keeps its last frame, the sound goes on.
        Some(e) => tracing::info!("the capture stopped: {e}, keeping the last frame"),
        None => tracing::info!("the capture stopped, keeping the last frame"),
    });
    let mut stream = SCStream::new_with_delegate(&filter, &config, callbacks).map_err(|e| eyre!("capture stream: {e}"))?;
    let output = Output {
        latest,
        scratch: Mutex::new(Frame::black(out_size.0, out_size.1)),
        warned: AtomicBool::new(false),
    };
    stream
        .add_output_handler(output, SCStreamOutputType::Screen)
        .map_err(|e| eyre!("capture output: {e}"))?;
    stream.start_capture().map_err(|e| eyre!("start the capture: {e}"))?;
    Ok(CaptureHandle { stream: Some(stream) })
}
