use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::services::process_manager;

#[derive(Debug, Clone)]
pub struct MediaProbe {
    pub duration_ms: Option<u64>,
    pub has_audio: bool,
    pub has_video: bool,
}

/// Check that an exported file is playable and has the expected streams.
pub async fn probe_media(ffprobe: &Path, file: &Path) -> Option<MediaProbe> {
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        file.to_string_lossy().into_owned(),
    ];
    let output = process_manager::run_capture(ffprobe, &args, Duration::from_secs(30))
        .await
        .ok()?;
    if !output.success {
        return None;
    }
    let json: Value = serde_json::from_str(&output.stdout).ok()?;

    let mut has_audio = false;
    let mut has_video = false;
    if let Some(streams) = json.get("streams").and_then(|v| v.as_array()) {
        for stream in streams {
            match stream.get("codec_type").and_then(|v| v.as_str()) {
                Some("audio") => has_audio = true,
                Some("video") => has_video = true,
                _ => {}
            }
        }
    }

    let duration_ms = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0).round() as u64);

    Some(MediaProbe {
        duration_ms,
        has_audio,
        has_video,
    })
}
