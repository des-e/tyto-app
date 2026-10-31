use std::path::{Path, PathBuf};

/// Below this much free space the recording stops by itself and is saved.
pub const MIN_FREE_BYTES: u64 = 500 * 1024 * 1024;

pub fn should_stop(free: u64) -> bool {
    free < MIN_FREE_BYTES
}

/// Free bytes of the disk holding `dir`: the longest mount point that is a prefix of it.
pub fn disk_for_path(disks: &[(PathBuf, u64)], dir: &Path) -> Option<u64> {
    disks
        .iter()
        .filter(|(mount, _)| dir.starts_with(mount))
        .max_by_key(|(mount, _)| mount.components().count())
        .map(|(_, free)| *free)
}

/// `\\?\C:\x` → `C:\x`, `c:\x` → `C:\x`, so lookups match the mount points sysinfo reports.
fn normalize(p: &Path) -> PathBuf {
    let p = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    if !cfg!(windows) {
        return p;
    }
    let s = p.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    let mut chars: Vec<char> = s.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        chars[0] = chars[0].to_ascii_uppercase();
    }
    PathBuf::from(chars.into_iter().collect::<String>())
}

/// Free space on the disk that holds `dir`; `None` if no disk matches.
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
        assert!(should_stop(400 * 1024 * 1024) && !should_stop(600 * 1024 * 1024));
        let disks = [
            (PathBuf::from("C:\\"), 1),
            (PathBuf::from("/"), 2),
            (PathBuf::from("/Volumes/Data"), 3),
        ];
        assert_eq!(disk_for_path(&disks, Path::new("/Volumes/Data/Tyto/Записи")), Some(3));
        assert_eq!(disk_for_path(&disks, Path::new("/Users/d")), Some(2));
    }

    #[test]
    fn free_space_finds_the_disk_of_a_real_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(free_space(dir.path()).is_some_and(|free| free > 0));
    }
}
