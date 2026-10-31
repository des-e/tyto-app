// Items are consumed by later screen-recording tasks.
// TODO: remove this allow when the capture is wired in (Task 11, Windows capture),
// otherwise it hides real dead code.
#![allow(dead_code)]

pub mod audio_sink;
pub mod commands;
pub mod disk;
pub mod encoder;
pub mod pacer;
pub mod quality;
pub mod recorder;
pub mod recovery;
pub mod segments;
pub mod session;
