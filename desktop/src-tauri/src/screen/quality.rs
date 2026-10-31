use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Good,
    High,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Preset {
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub maxrate_kbps: u32,
    pub bufsize_kbps: u32,
    pub max_width: u32,
    pub max_height: u32,
}

pub fn preset(q: Quality) -> Preset {
    match q {
        Quality::Good => Preset {
            fps: 15,
            bitrate_kbps: 2000,
            maxrate_kbps: 3000,
            bufsize_kbps: 4000,
            max_width: 1920,
            max_height: 1080,
        },
        Quality::High => Preset {
            fps: 30,
            bitrate_kbps: 4000,
            maxrate_kbps: 6000,
            bufsize_kbps: 8000,
            max_width: 1920,
            max_height: 1080,
        },
    }
}

fn even_down(v: u64) -> u32 {
    (((v & !1).max(2)) as u32).max(2)
}

/// Fits the source into the preset's maximum size without upscaling,
/// keeping the aspect ratio. Both sides are even (rounded down).
pub fn output_size(src_w: u32, src_h: u32, p: &Preset) -> (u32, u32) {
    let (w, h) = (src_w as u64, src_h as u64);
    let (mw, mh) = (p.max_width as u64, p.max_height as u64);
    if w == 0 || h == 0 {
        return (2, 2);
    }
    if w <= mw && h <= mh {
        return (even_down(w), even_down(h));
    }
    let (nw, nh) = if w * mh > h * mw { (mw, h * mw / w) } else { (w * mh / h, mh) };
    (even_down(nw), even_down(nh))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// The largest rectangle with the source's aspect ratio that fits `dst`, centered.
pub fn letterbox(src: (u32, u32), dst: (u32, u32)) -> Rect {
    let (sw, sh) = (src.0 as u64, src.1 as u64);
    let (dw, dh) = (dst.0 as u64, dst.1 as u64);
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 {
        return Rect {
            x: 0,
            y: 0,
            w: dst.0,
            h: dst.1,
        };
    }
    let (w, h) = if sw * dh > sh * dw {
        (dw, sh * dw / sw)
    } else {
        (sw * dh / sh, dh)
    };
    // Even sides, so the rect can feed the encoder directly.
    let (w, h) = (w & !1, h & !1);
    Rect {
        x: ((dw - w) / 2) as u32,
        y: ((dh - h) / 2) as u32,
        w: w as u32,
        h: h as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn good_and_high_presets_match_the_spec() {
        assert_eq!((preset(Quality::Good).fps, preset(Quality::Good).bitrate_kbps), (15, 2000));
        assert_eq!((preset(Quality::High).fps, preset(Quality::High).bitrate_kbps), (30, 4000));
        // about 1 and 2 GB per hour with AAC 128k
        let gb = |q| (preset(q).bitrate_kbps + 128) as f64 * 3600.0 / 8.0 / 1e6;
        assert!((0.8..1.2).contains(&gb(Quality::Good)) && (1.6..2.2).contains(&gb(Quality::High)));
    }

    #[test]
    fn output_size_caps_at_1080p_keeps_aspect_and_even_sides() {
        let p = preset(Quality::Good);
        assert_eq!(output_size(3840, 2160, &p), (1920, 1080));
        assert_eq!(output_size(2560, 1600, &p), (1728, 1080));
        assert_eq!(output_size(5120, 1440, &p), (1920, 540));
        assert_eq!(output_size(1366, 768, &p), (1366, 768));
        assert_eq!(output_size(1365, 767, &p), (1364, 766));
    }

    #[test]
    fn letterbox_centers_a_resized_window() {
        assert_eq!(
            letterbox((800, 600), (1600, 900)),
            Rect {
                x: 200,
                y: 0,
                w: 1200,
                h: 900
            }
        );
        assert_eq!(
            letterbox((1600, 900), (1600, 900)),
            Rect {
                x: 0,
                y: 0,
                w: 1600,
                h: 900
            }
        );
    }
}
