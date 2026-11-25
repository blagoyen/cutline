use serde_json::Value;

use crate::error::CommandError;
use crate::models::video::{Chapter, FormatInfo, VideoInfo, VideoSource};

fn as_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn as_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
    })
}

fn as_f64(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
}

fn thumbnail_of(value: &Value) -> Option<String> {
    if let Some(url) = as_str(value, "thumbnail") {
        return Some(url);
    }
    let thumbnails = value.get("thumbnails")?.as_array()?;
    let mut best: Option<(u64, String)> = None;
    for thumb in thumbnails {
        let Some(url) = as_str(thumb, "url") else {
            continue;
        };
        let width = thumb
            .get("preference")
            .and_then(|v| v.as_f64())
            .or_else(|| thumb.get("width").and_then(|v| v.as_f64()))
            .unwrap_or(0.0) as u64;
        if best.as_ref().map(|(w, _)| width >= *w).unwrap_or(true) {
            best = Some((width, url));
        }
    }
    best.map(|(_, url)| url)
}

fn format_upload_date(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    if raw.len() == 8 {
        Some(format!(
            "{}-{}-{}",
            &raw[0..4],
            &raw[4..6],
            &raw[6..8]
        ))
    } else {
        Some(raw)
    }
}

fn parse_formats(value: &Value) -> (Vec<FormatInfo>, Vec<u32>) {
    let Some(formats) = value.get("formats").and_then(|v| v.as_array()) else {
        return (Vec::new(), Vec::new());
    };

    let mut parsed: Vec<FormatInfo> = Vec::new();
    let mut heights: Vec<u32> = Vec::new();

    for format in formats {
        let height = as_u64(format, "height").map(|h| h as u32).filter(|h| *h > 0);
        let Some(height) = height else { continue };
        let vcodec = as_str(format, "vcodec").unwrap_or_else(|| "none".into());
        if vcodec == "none" {
            continue;
        }
        if !heights.contains(&height) {
            heights.push(height);
        }
        let ext = as_str(format, "ext").unwrap_or_else(|| "mp4".into());
        parsed.push(FormatInfo {
            format_id: as_str(format, "format_id").unwrap_or_default(),
            ext,
            height: Some(height),
            width: as_u64(format, "width").map(|w| w as u32),
            fps: as_f64(format, "fps"),
            vcodec: Some(vcodec),
            acodec: Some(as_str(format, "acodec").unwrap_or_else(|| "none".into())),
            filesize: as_u64(format, "filesize").or_else(|| as_u64(format, "filesize_approx")),
            note: as_str(format, "format_note"),
        });
    }

    heights.sort_by(|a, b| b.cmp(a));
    // Keep the payload small: prefer the highest-quality entry per resolution.
    parsed.sort_by(|a, b| b.height.cmp(&a.height));
    parsed.truncate(40);

    (parsed, heights)
}

fn parse_chapters(value: &Value, duration_ms: u64) -> Vec<Chapter> {
    let Some(entries) = value.get("chapters").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut chapters: Vec<Chapter> = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        let start = as_f64(entry, "start_time").unwrap_or(0.0);
        let end = as_f64(entry, "end_time").unwrap_or(start);
        let start_ms = (start.max(0.0) * 1000.0).round() as u64;
        let mut end_ms = (end.max(start) * 1000.0).round() as u64;
        if duration_ms > 0 {
            end_ms = end_ms.min(duration_ms);
        }
        if end_ms <= start_ms {
            continue;
        }
        chapters.push(Chapter {
            start_ms,
            end_ms,
            title: as_str(entry, "title").unwrap_or_else(|| format!("Chapter {}", index + 1)),
        });
    }
    chapters
}

/// Convert `yt-dlp -J` output into UI video info.
pub fn parse_video_info(value: &Value) -> Result<VideoInfo, CommandError> {
    let mut target = value;

    if value.get("_type").and_then(|v| v.as_str()) == Some("playlist") {
        let entries = value.get("entries").and_then(|v| v.as_array());
        match entries.and_then(|e| e.iter().find(|item| item.get("id").is_some())) {
            Some(entry) => target = entry,
            None => {
                return Err(CommandError::new(
                    "PLAYLIST_EMPTY",
                    "That link points to a playlist. Paste a link to a single video.",
                ))
            }
        }
    }

    let id = as_str(target, "id").ok_or_else(|| {
        CommandError::new(
            "NO_VIDEO_DATA",
            "YouTube did not return video information for that link.",
        )
    })?;

    let duration_secs = as_f64(target, "duration").unwrap_or(0.0);
    let duration_ms = (duration_secs * 1000.0).round().max(0.0) as u64;
    let is_live = target
        .get("is_live")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || target
            .get("live_status")
            .and_then(|v| v.as_str())
            .map(|s| s == "is_live" || s == "is_upcoming")
            .unwrap_or(false);

    let (formats, heights) = parse_formats(target);
    let max_height = heights.first().copied().unwrap_or(0);

    let webpage_url = as_str(target, "webpage_url")
        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", id));

    let extractor = as_str(target, "extractor_key")
        .or_else(|| as_str(target, "extractor"))
        .unwrap_or_default()
        .to_lowercase();
    let source = if extractor.contains("twitch") || webpage_url.to_lowercase().contains("twitch.tv") {
        VideoSource::Twitch
    } else {
        VideoSource::Youtube
    };

    // Strip leading "v" from Twitch VOD ids returned by yt-dlp (e.g. "v1234567890" -> "1234567890").
    let clean_id = if source == VideoSource::Twitch {
        id.strip_prefix('v')
            .filter(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
            .map(str::to_string)
            .unwrap_or(id)
    } else {
        id
    };

    let title = as_str(target, "title")
        .or_else(|| as_str(target, "fulltitle"))
        .unwrap_or_else(|| "Untitled video".to_string());

    Ok(VideoInfo {
        id: clean_id,
        source,
        title,
        duration_ms,
        thumbnail: thumbnail_of(target).unwrap_or_default(),
        uploader: as_str(target, "uploader")
            .or_else(|| as_str(target, "channel"))
            .or_else(|| as_str(target, "creator")),
        webpage_url,
        is_live,
        max_height,
        heights,
        formats,
        upload_date: format_upload_date(as_str(target, "upload_date")),
        view_count: as_u64(target, "view_count"),
        chapters: parse_chapters(target, duration_ms),
    })
}

/// Parse `yt-dlp -J` JSON.
pub fn parse_json(bytes: &[u8]) -> Result<Value, CommandError> {
    serde_json::from_slice::<Value>(bytes).map_err(|err| {
        CommandError::new(
            "INVALID_METADATA",
            "Could not read the video information returned by yt-dlp.",
        )
        .with_detail(err.to_string())
    })
}
