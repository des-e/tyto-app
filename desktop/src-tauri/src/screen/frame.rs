//! The captured picture shared between the capture and the segment writer.
// Both captures call `resize_into`; on the Mac it only drops the row padding
// (ScreenCaptureKit scales the picture itself).
#![cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]

use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use fast_image_resize::images::{CroppedImageMut, Image, ImageRef};
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};

use super::quality::letterbox;

/// A BGRA picture, `width * height * 4` bytes, no row padding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Frame {
    /// An opaque black frame.
    pub fn black(width: u32, height: u32) -> Self {
        let mut f = Frame {
            width,
            height,
            data: vec![0; width as usize * height as usize * 4],
        };
        fill_black(&mut f.data);
        f
    }
}

/// The last picture of the capture, at the session size. `None` until the first frame.
pub type LatestFrame = Arc<Mutex<Option<Frame>>>;

const BLACK: [u8; 4] = [0, 0, 0, 255];

fn fill_black(data: &mut [u8]) {
    for px in data.as_chunks_mut::<4>().0 {
        *px = BLACK;
    }
}

thread_local! {
    static RESIZER: RefCell<Resizer> = RefCell::new(Resizer::new());
}

/// Draws `src` (BGRA, `src_stride` bytes per row) into `dst`, scaled to fit and
/// centered, with black bars. `dst` keeps its size: it is the session size, so a
/// window that changed its size mid-recording is letterboxed into it.
pub fn resize_into(src: &[u8], src_w: u32, src_h: u32, src_stride: u32, dst: &mut Frame) {
    let dst_len = dst.width as usize * dst.height as usize * 4;
    dst.data.resize(dst_len, 0);
    let stride = src_stride as usize;
    let valid = src_w > 0
        && src_h > 0
        && stride >= src_w as usize * 4
        && stride.is_multiple_of(4)
        && src.len() >= stride * (src_h as usize - 1) + src_w as usize * 4;
    let rect = letterbox((src_w, src_h), (dst.width, dst.height));
    if !valid || rect.w == 0 || rect.h == 0 {
        fill_black(&mut dst.data);
        return;
    }
    if (rect.w, rect.h) != (dst.width, dst.height) {
        fill_black(&mut dst.data);
    }
    let dst_stride = dst.width as usize * 4;
    if (rect.w, rect.h) == (src_w, src_h) {
        // Same size (the usual case for a 1080p screen): copy the rows.
        let row = src_w as usize * 4;
        for y in 0..src_h as usize {
            let from = y * stride;
            let to = (rect.y as usize + y) * dst_stride + rect.x as usize * 4;
            dst.data[to..to + row].copy_from_slice(&src[from..from + row]);
        }
        return;
    }
    // A padded source is read as a wider image cropped to its real width.
    let rows = &src[..stride * src_h as usize];
    let Ok(src_img) = ImageRef::new((stride / 4) as u32, src_h, rows, PixelType::U8x4) else {
        fill_black(&mut dst.data);
        return;
    };
    let Ok(mut dst_img) = Image::from_slice_u8(dst.width, dst.height, &mut dst.data, PixelType::U8x4) else {
        return;
    };
    let Ok(mut area) = CroppedImageMut::new(&mut dst_img, rect.x, rect.y, rect.w, rect.h) else {
        return;
    };
    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))
        .crop(0.0, 0.0, f64::from(src_w), f64::from(src_h))
        .use_alpha(false);
    RESIZER.with(|r| {
        if let Err(e) = r.borrow_mut().resize(&src_img, &mut area, &options) {
            tracing::warn!("scaling a captured frame failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(f: &Frame, y: u32) -> Vec<[u8; 4]> {
        let w = f.width as usize * 4;
        f.data[y as usize * w..(y as usize + 1) * w].as_chunks::<4>().0.to_vec()
    }

    #[test]
    fn resized_window_is_letterboxed_into_the_session_frame() {
        // src 4×2 белый, dst 4×4 → строки 0 и 3 черные (0,0,0,255), строки 1–2 белые
        let src = vec![255u8; 4 * 2 * 4];
        let mut dst = Frame::black(4, 4);
        dst.data.fill(7);
        resize_into(&src, 4, 2, 16, &mut dst);
        for y in [0, 3] {
            assert_eq!(row(&dst, y), vec![[0, 0, 0, 255]; 4], "row {y}");
        }
        for y in [1, 2] {
            assert_eq!(row(&dst, y), vec![[255, 255, 255, 255]; 4], "row {y}");
        }
    }

    #[test]
    fn padded_rows_are_skipped() {
        // 4×2 white with 8 bytes of (black) padding per row.
        let stride = 4 * 4 + 8;
        let mut src = vec![0u8; stride * 2];
        for y in 0..2 {
            src[y * stride..y * stride + 16].fill(255);
        }
        let mut dst = Frame::black(4, 4);
        resize_into(&src, 4, 2, stride as u32, &mut dst);
        assert_eq!(row(&dst, 0), vec![[0, 0, 0, 255]; 4]);
        assert_eq!(row(&dst, 1), vec![[255, 255, 255, 255]; 4]);
        assert_eq!(row(&dst, 2), vec![[255, 255, 255, 255]; 4]);
    }

    #[test]
    fn a_large_source_is_scaled_down_inside_the_bars() {
        // 16×8 white into 8×8: scaled to 8×4 in the middle.
        let src = vec![255u8; 16 * 8 * 4];
        let mut dst = Frame::black(8, 8);
        resize_into(&src, 16, 8, 16 * 4, &mut dst);
        for y in [0, 1, 6, 7] {
            assert_eq!(row(&dst, y), vec![[0, 0, 0, 255]; 8], "row {y}");
        }
        for y in 2..6 {
            assert!(
                row(&dst, y).iter().all(|p| p[0] >= 250 && p[1] >= 250 && p[2] >= 250),
                "row {y}"
            );
        }
        assert_eq!(dst.data.len(), 8 * 8 * 4);
    }

    #[test]
    fn a_broken_source_gives_a_black_frame() {
        let mut dst = Frame::black(4, 4);
        dst.data.fill(9);
        resize_into(&[1, 2, 3], 4, 2, 16, &mut dst);
        assert_eq!(dst, Frame::black(4, 4));
    }
}
