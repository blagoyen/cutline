use std::time::Duration;

use serde_json::Value;

use crate::error::CommandError;
use crate::models::video::{VideoInfo, VideoSource};
use crate::services::stream_proxy;

pub const TIKTOK_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const TIKTOK_REFERER: &str = "https://www.tiktok.com/";

#[derive(Debug, Clone)]
pub struct TikTokSound {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub play_url: String,
    pub thumbnail: String,
    pub duration_ms: u64,
    pub video_count: Option<u64>,
    pub webpage_url: String,
}

pub fn is_tiktok_sound_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("tiktok.com/music/")
}

fn extract_script_json<'a>(html: &'a str, script_id: &str) -> Option<&'a str> {
    let needle = format!("id=\"{script_id}\"");
    let start = html.find(&needle)?;
    let open_end = html[start..].find('>')? + start + 1;
    let close = html[open_end..].find("</script>")? + open_end;
    Some(html[open_end..close].trim())
}

fn str_field(val: &Value, key: &str) -> Option<String> {
    val.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn u64_field(val: &Value, key: &str) -> Option<u64> {
    val.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
    })
}

fn parse_music_from_universal_data(root: &Value, webpage_url: &str) -> Option<TikTokSound> {
    let scope = root.get("__DEFAULT_SCOPE__")?;
    let detail = scope
        .get("webapp.music-detail")
        .or_else(|| scope.get("webapp.music-detail-v2"))?;
    let music_info = detail.get("musicInfo")?;
    let music = music_info.get("music")?;
    let play_url = str_field(music, "playUrl")?;
    let id = str_field(music, "id").unwrap_or_else(|| "tiktok-sound".to_string());
    let title = str_field(music, "title").unwrap_or_else(|| "TikTok Sound".to_string());
    let author = str_field(music, "authorName")
        .or_else(|| music_info.get("author").and_then(|a| str_field(a, "nickname")))
        .or_else(|| music_info.get("author").and_then(|a| str_field(a, "uniqueId")));
    let thumbnail = str_field(music, "coverLarge")
        .or_else(|| str_field(music, "coverMedium"))
        .or_else(|| str_field(music, "coverThumb"))
        .unwrap_or_default();
    let duration_secs = u64_field(music, "duration").unwrap_or(0);
    let video_count = music_info
        .get("stats")
        .and_then(|s| u64_field(s, "videoCount"));

    Some(TikTokSound {
        id,
        title,
        author,
        play_url,
        thumbnail,
        duration_ms: duration_secs.saturating_mul(1000),
        video_count,
        webpage_url: webpage_url.to_string(),
    })
}

fn parse_music_from_sigi(root: &Value, webpage_url: &str) -> Option<TikTokSound> {
    let module = root.get("MusicModule")?;
    let music_info = module.get("musicInfo")?;
    let music = music_info.get("music")?;
    let play_url = str_field(music, "playUrl")?;
    let id = str_field(music, "id").unwrap_or_else(|| "tiktok-sound".to_string());
    let title = str_field(music, "title").unwrap_or_else(|| "TikTok Sound".to_string());
    let author = str_field(music, "authorName");
    let thumbnail = str_field(music, "coverLarge")
        .or_else(|| str_field(music, "coverMedium"))
        .or_else(|| str_field(music, "coverThumb"))
        .unwrap_or_default();
    let duration_secs = u64_field(music, "duration").unwrap_or(0);
    let video_count = music_info
        .get("stats")
        .and_then(|s| u64_field(s, "videoCount"));

    Some(TikTokSound {
        id,
        title,
        author,
        play_url,
        thumbnail,
        duration_ms: duration_secs.saturating_mul(1000),
        video_count,
        webpage_url: webpage_url.to_string(),
    })
}

/// Fetch a TikTok `/music/...` sound page and extract the direct master audio `playUrl` and metadata.
pub async fn resolve_sound(url: &str) -> Result<TikTokSound, CommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| CommandError::new("HTTP_ERROR", format!("HTTP client error: {e}")))?;

    let resp = client
        .get(url)
        .header("User-Agent", TIKTOK_USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", TIKTOK_REFERER)
        .send()
        .await
        .map_err(|e| {
            CommandError::new(
                "NETWORK_ERROR",
                "Could not reach TikTok to load this sound.",
            )
            .with_detail(e.to_string())
        })?;

    let final_url = resp.url().to_string();
    if !resp.status().is_success() {
        return Err(CommandError::new(
            "TIKTOK_SOUND_UNAVAILABLE",
            format!("TikTok returned HTTP {} for this sound.", resp.status().as_u16()),
        ));
    }

    let html = resp.text().await.map_err(|e| {
        CommandError::new("NETWORK_ERROR", "Could not read TikTok sound page.")
            .with_detail(e.to_string())
    })?;

    if let Some(raw) = extract_script_json(&html, "__UNIVERSAL_DATA_FOR_REHYDRATION__") {
        if let Ok(json) = serde_json::from_str::<Value>(raw) {
            if let Some(sound) = parse_music_from_universal_data(&json, &final_url) {
                return Ok(sound);
            }
        }
    }

    if let Some(raw) = extract_script_json(&html, "SIGI_STATE") {
        if let Ok(json) = serde_json::from_str::<Value>(raw) {
            if let Some(sound) = parse_music_from_sigi(&json, &final_url) {
                return Ok(sound);
            }
        }
    }

    Err(CommandError::new(
        "TIKTOK_SOUND_NOT_FOUND",
        "Could not extract the audio track from this TikTok sound page.",
    ))
}

/// Probe a TikTok `/music/...` URL into `VideoInfo` with a localhost-proxied audio preview stream.
pub async fn probe_sound(url: &str) -> Result<VideoInfo, CommandError> {
    let sound = resolve_sound(url).await?;
    let proxied_stream = stream_proxy::register_with_headers(
        sound.play_url.clone(),
        Some(TIKTOK_USER_AGENT.to_string()),
        Some(TIKTOK_REFERER.to_string()),
        None,
        "mp3",
    )
    .ok();

    Ok(VideoInfo {
        id: sound.id,
        source: VideoSource::Tiktok,
        title: sound.title,
        duration_ms: if sound.duration_ms > 0 {
            sound.duration_ms
        } else {
            60_000
        },
        thumbnail: sound.thumbnail,
        uploader: sound.author,
        webpage_url: sound.webpage_url,
        stream_url: proxied_stream,
        audio_stream_url: None,
        audio_only: true,
        is_live: false,
        max_height: 0,
        heights: Vec::new(),
        formats: Vec::new(),
        upload_date: None,
        view_count: sound.video_count,
        chapters: Vec::new(),
    })
}
