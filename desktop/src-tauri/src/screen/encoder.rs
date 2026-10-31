use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::quality::Preset;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoEncoder {
    Nvenc,
    Qsv,
    Amf,
    MediaFoundation,
    VideoToolbox,
    X264,
}

impl VideoEncoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            VideoEncoder::Nvenc => "h264_nvenc",
            VideoEncoder::Qsv => "h264_qsv",
            VideoEncoder::Amf => "h264_amf",
            VideoEncoder::MediaFoundation => "h264_mf",
            VideoEncoder::VideoToolbox => "h264_videotoolbox",
            VideoEncoder::X264 => "libx264",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetOs {
    Windows,
    MacOs,
}

impl TargetOs {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            TargetOs::MacOs
        } else {
            TargetOs::Windows
        }
    }
}

/// Encoder names from `ffmpeg -encoders` output (video codec rows only).
pub fn parse_encoders(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let flags = it.next()?;
            let name = it.next()?;
            let is_video =
                flags.len() == 6 && flags.starts_with('V') && flags[1..].chars().all(|c| c == '.' || c.is_ascii_alphabetic());
            (is_video && name != "=").then(|| name.to_string())
        })
        .collect()
}

/// Encoders to try, in preference order, limited to those present in `listed`.
pub fn candidates(listed: &[String], os: TargetOs) -> Vec<VideoEncoder> {
    let order: &[VideoEncoder] = match os {
        TargetOs::Windows => &[
            VideoEncoder::Nvenc,
            VideoEncoder::Qsv,
            VideoEncoder::Amf,
            VideoEncoder::MediaFoundation,
            VideoEncoder::X264,
        ],
        TargetOs::MacOs => &[VideoEncoder::VideoToolbox, VideoEncoder::X264],
    };
    order
        .iter()
        .copied()
        .filter(|e| listed.iter().any(|n| n == e.ffmpeg_name()))
        .collect()
}

/// Raw BGRA frames on stdin, fragmented MP4 (video only) out.
pub fn video_segment_args(enc: VideoEncoder, p: &Preset, size: (u32, u32), out: &Path) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&["-hide_banner", "-loglevel", "error", "-y"]);
    push(&["-f", "rawvideo", "-pix_fmt", "bgra"]);
    let video_size = format!("{}x{}", size.0, size.1);
    push(&["-video_size", &video_size]);
    let fps = p.fps.to_string();
    push(&["-framerate", &fps, "-i", "pipe:0", "-an"]);
    push(&["-c:v", enc.ffmpeg_name()]);
    match enc {
        VideoEncoder::Nvenc => push(&["-preset", "p4", "-rc", "vbr"]),
        VideoEncoder::Qsv => push(&["-preset", "veryfast"]),
        VideoEncoder::Amf => push(&["-quality", "speed", "-rc", "vbr_peak"]),
        VideoEncoder::MediaFoundation => push(&["-hw_encoding", "1", "-rate_control", "u_vbr", "-scenario", "display_remoting"]),
        VideoEncoder::VideoToolbox => push(&["-realtime", "1", "-allow_sw", "1"]),
        VideoEncoder::X264 => push(&["-preset", "veryfast"]),
    }
    let bitrate = format!("{}k", p.bitrate_kbps);
    let maxrate = format!("{}k", p.maxrate_kbps);
    let bufsize = format!("{}k", p.bufsize_kbps);
    let gop = (p.fps * 2).to_string();
    push(&["-b:v", &bitrate, "-maxrate", &maxrate, "-bufsize", &bufsize, "-g", &gop]);
    if enc == VideoEncoder::X264 {
        push(&["-pix_fmt", "yuv420p"]);
    } else {
        push(&["-vf", "format=nv12"]);
    }
    push(&["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]);
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Encodes a single synthetic frame to check the encoder works on this machine.
pub fn probe_args(enc: VideoEncoder) -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=256x144:rate=1",
        "-frames:v",
        "1",
        "-c:v",
        enc.ffmpeg_name(),
        "-f",
        "null",
        "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Search order: exe dir, `../Resources` (mac bundle), cwd, PATH.
/// The bundle wins over PATH on purpose: users get the essentials build.
pub fn ffmpeg_candidates(exe_dir: Option<&Path>, cwd: Option<&Path>, on_path: Option<PathBuf>) -> Vec<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut v = Vec::new();
    if let Some(d) = exe_dir {
        v.push(d.join(name));
        v.push(d.join("../Resources").join(name));
    }
    if let Some(d) = cwd {
        v.push(d.join(name));
    }
    if let Some(p) = on_path {
        v.push(p);
    }
    v
}

fn find_on_path() -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file())
}

/// First existing ffmpeg: the bundled one, then PATH.
pub fn bundled_ffmpeg() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok();
    let cwd = std::env::current_dir().ok();
    ffmpeg_candidates(exe.as_deref().and_then(|e| e.parent()), cwd.as_deref(), find_on_path())
        .into_iter()
        .find(|p| p.is_file())
}

fn run(ffmpeg: &Path, args: &[String]) -> Option<std::process::Output> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().ok()
}

/// Picks the first encoder that is listed by the bundle and passes a probe.
/// The bundle may lack libx264, so the last resort is the platform's own encoder.
/// Cached for the lifetime of the process.
pub fn select_encoder(ffmpeg: &Path, os: TargetOs) -> VideoEncoder {
    static CACHE: OnceLock<VideoEncoder> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let listed = run(ffmpeg, &["-hide_banner".to_string(), "-encoders".to_string()])
            .map(|o| parse_encoders(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default();
        let list = candidates(&listed, os);
        let chosen = list
            .iter()
            .copied()
            .find(|e| run(ffmpeg, &probe_args(*e)).map(|o| o.status.success()).unwrap_or(false))
            .unwrap_or_else(|| {
                list.last().copied().unwrap_or(match os {
                    TargetOs::Windows => VideoEncoder::MediaFoundation,
                    TargetOs::MacOs => VideoEncoder::VideoToolbox,
                })
            });
        tracing::info!("selected encoder {}", chosen.ffmpeg_name());
        chosen
    })
}

#[cfg(test)]
mod tests {
    use super::super::quality::{preset, Quality};
    use super::*;

    #[test]
    fn candidates_follow_platform_order_and_bundle_contents() {
        let listed =
            parse_encoders(" V....D libx264  libx264 H.264\n V....D h264_mf  H264 via MediaFoundation\n A....D aac  AAC\n");
        assert_eq!(listed, vec!["libx264", "h264_mf"]);
        assert_eq!(
            candidates(&listed, TargetOs::Windows),
            vec![VideoEncoder::MediaFoundation, VideoEncoder::X264]
        );
        assert_eq!(candidates(&["libx264".into()], TargetOs::MacOs), vec![VideoEncoder::X264]);
    }

    #[test]
    fn bundle_without_libx264_still_yields_platform_encoder() {
        let listed = parse_encoders(
            " V..... = Video\n ------\n V....D h264_mf  H264 via MediaFoundation\n V....D h264_videotoolbox  VT\n A....D aac  AAC\n",
        );
        assert_eq!(listed, vec!["h264_mf", "h264_videotoolbox"]);
        assert_eq!(candidates(&listed, TargetOs::Windows), vec![VideoEncoder::MediaFoundation]);
        assert_eq!(candidates(&listed, TargetOs::MacOs), vec![VideoEncoder::VideoToolbox]);
    }

    #[test]
    fn segment_args_are_raw_bgra_in_fragmented_mp4_out() {
        let args = video_segment_args(
            VideoEncoder::X264,
            &preset(Quality::Good),
            (1920, 1080),
            Path::new("seg-0001.mp4"),
        )
        .join(" ");
        for part in [
            "-f rawvideo",
            "-pix_fmt bgra",
            "-video_size 1920x1080",
            "-framerate 15",
            "-i pipe:0",
            "-c:v libx264",
            "-preset veryfast",
            "-b:v 2000k",
            "-maxrate 3000k",
            "-bufsize 4000k",
            "-g 30",
            "-pix_fmt yuv420p",
            "-movflags +frag_keyframe+empty_moov+default_base_moof",
            "-f mp4",
        ] {
            assert!(args.contains(part), "{part} in {args}");
        }
        let hw = video_segment_args(
            VideoEncoder::MediaFoundation,
            &preset(Quality::High),
            (1280, 720),
            Path::new("s.mp4"),
        )
        .join(" ");
        assert!(
            hw.contains("-c:v h264_mf") && hw.contains("-hw_encoding 1") && hw.contains("format=nv12") && hw.contains("-g 60")
        );
    }

    #[test]
    fn bundled_ffmpeg_wins_over_path() {
        let c = ffmpeg_candidates(
            Some(Path::new("/app")),
            Some(Path::new("/cwd")),
            Some(PathBuf::from("/usr/bin/ffmpeg")),
        );
        assert_eq!(
            c.first().unwrap(),
            &Path::new("/app").join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
        );
        assert_eq!(c.last().unwrap(), &PathBuf::from("/usr/bin/ffmpeg"));
    }
}
