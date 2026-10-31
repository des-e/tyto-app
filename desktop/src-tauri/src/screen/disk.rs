use std::path::{Path, PathBuf};

/// Free space that must remain after the final file is written.
pub const MIN_FREE_BYTES: u64 = 500 * 1024 * 1024;
/// AAC 128 kbit/s in the final file.
const AUDIO_BYTES_PER_SEC: u64 = 128_000 / 8;

/// Stop when the space left would not hold the final file (`reserve`) plus `MIN_FREE_BYTES`:
/// the mux writes next to the segments, on the same disk.
pub fn should_stop(free: u64, reserve: u64) -> bool {
    free < MIN_FREE_BYTES.saturating_add(reserve)
}

/// Estimated size of the final file: the video segments so far (`-c:v copy`
/// keeps their size) plus the AAC track for `active_ms`.
pub fn mux_reserve(session_dir: &Path, active_ms: u64) -> u64 {
    let video: u64 = std::fs::read_dir(session_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "mp4"))
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0);
    video + AUDIO_BYTES_PER_SEC * active_ms / 1000
}

/// Free bytes of the disk holding `dir`: the longest mount point that is a prefix of it.
pub fn disk_for_path(disks: &[(PathBuf, u64)], dir: &Path) -> Option<u64> {
    disks
        .iter()
        .filter(|(mount, _)| dir.starts_with(mount))
        .max_by_key(|(mount, _)| mount.components().count())
        .map(|(_, free)| *free)
}

/// Resolves junctions and symlinks of the deepest existing ancestor (Documents
/// moved to another disk), then `\\?\C:\x` → `C:\x` and `c:\x` → `C:\x`, so the
/// path matches the mount points sysinfo reports.
fn normalize(p: &Path) -> PathBuf {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let mut resolved = abs.clone();
    for base in abs.ancestors() {
        if let Ok(real) = std::fs::canonicalize(base) {
            resolved = abs.strip_prefix(base).map(|rest| real.join(rest)).unwrap_or(real);
            break;
        }
    }
    if !cfg!(windows) {
        return resolved;
    }
    let s = resolved.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    let mut chars: Vec<char> = s.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        chars[0] = chars[0].to_ascii_uppercase();
    }
    PathBuf::from(chars.into_iter().collect::<String>())
}

/// Free space on the disk that holds `dir`; `None` if no disk matches (network
/// shares are not listed): the caller then does not stop. Lists every volume,
/// so poll it every 5-10 s, not per frame.
pub fn free_space(dir: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let list: Vec<(PathBuf, u64)> = disks
        .list()
        .iter()
        .map(|d| (normalize(d.mount_point()), d.available_space()))
        .collect();
    disk_for_path(&list, &normalize(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_disk_threshold_and_mount_lookup() {
        assert!(should_stop(400 * 1024 * 1024, 0) && !should_stop(600 * 1024 * 1024, 0));
        let disks = [
            (PathBuf::from("C:\\"), 1),
            (PathBuf::from("/"), 2),
            (PathBuf::from("/Volumes/Data"), 3),
        ];
        assert_eq!(disk_for_path(&disks, Path::new("/Volumes/Data/Tyto/Записи")), Some(3));
        assert_eq!(disk_for_path(&disks, Path::new("/Users/d")), Some(2));
    }

    #[test]
    fn the_final_file_is_reserved_before_stopping() {
        let gb = 1024 * 1024 * 1024;
        // an hour of video: 1 GB of segments, 600 MB free is not enough to mux
        assert!(should_stop(600 * 1024 * 1024, gb));
        assert!(!should_stop(2 * gb, gb));

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seg-0001.mp4"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.path().join("seg-0002.mp4"), vec![0u8; 500]).unwrap();
        std::fs::write(dir.path().join("seg-0001.mic.wav"), vec![0u8; 9999]).unwrap();
        assert_eq!(mux_reserve(dir.path(), 10_000), 1_500 + 160_000);
        assert_eq!(mux_reserve(&dir.path().join("missing"), 0), 0);
    }

    #[test]
    fn free_space_finds_the_disk_of_a_real_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(free_space(dir.path()).is_some_and(|free| free > 0));
        // a folder that does not exist yet resolves through its parent
        assert!(free_space(&dir.path().join("Записи").join("new")).is_some());
    }
}
