use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// Lock a mutex and recover if it is poisoned.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `HH:MM:SS.mmm` — the format yt-dlp's `--download-sections` expects.
pub fn section_timestamp(ms: u64) -> String {
    let millis = ms % 1000;
    let total_seconds = ms / 1000;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Make a clip name safe for filenames.
pub fn sanitize_filename(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    for ch in name.chars() {
        let invalid = matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if invalid || (ch as u32) < 32 {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    let mut safe: String = trimmed.chars().take(120).collect();
    safe = safe.trim().to_string();
    if safe.is_empty() {
        safe = "clip".to_string();
    }
    let stem_upper = safe
        .split('.')
        .next()
        .unwrap_or(&safe)
        .trim()
        .to_uppercase();
    if WINDOWS_RESERVED.contains(&stem_upper.as_str()) {
        safe = format!("_{}", safe);
    }
    safe
}

/// Find an output path that does not already exist.
pub async fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let candidate = dir.join(format!("{}.{}", base, ext));
    if tokio::fs::metadata(&candidate).await.is_err() {
        return candidate;
    }
    for index in 2..=999 {
        let candidate = dir.join(format!("{} ({}).{}", base, index, ext));
        if tokio::fs::metadata(&candidate).await.is_err() {
            return candidate;
        }
    }
    dir.join(format!("{}-{}.{}", base, now_ms(), ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_timestamps_are_hh_mm_ss_mmm() {
        assert_eq!(section_timestamp(0), "00:00:00.000");
        assert_eq!(section_timestamp(1), "00:00:00.001");
        assert_eq!(section_timestamp(999), "00:00:00.999");
        assert_eq!(section_timestamp(61_005), "00:01:01.005");
        assert_eq!(section_timestamp(3_661_005), "01:01:01.005");
    }

    #[test]
    fn sanitizing_names_blocks_windows_hazards() {
        assert_eq!(sanitize_filename("  My:Clip?/Name  "), "My_Clip__Name");
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("   "), "clip");
        assert!(sanitize_filename(&"a".repeat(400)).chars().count() <= 120);
    }

    #[tokio::test]
    async fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ytcutter-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let first = unique_path(&dir, "Clip", "mp4").await;
        assert_eq!(first.file_name().unwrap(), "Clip.mp4");
        tokio::fs::write(&first, b"x").await.unwrap();

        let second = unique_path(&dir, "Clip", "mp4").await;
        assert_eq!(second.file_name().unwrap(), "Clip (2).mp4");
        tokio::fs::write(&second, b"x").await.unwrap();

        let third = unique_path(&dir, "Clip", "mp4").await;
        assert_eq!(third.file_name().unwrap(), "Clip (3).mp4");

        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }
}
