use std::time::Duration;

use serde_json::Value;

use crate::error::CommandError;
use crate::models::video::{VideoInfo, VideoSource};
use crate::models::Settings;
use crate::services::{binaries, process_manager, stream_proxy};
use crate::services::binaries::Tool;

pub const TIKTOK_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const TIKTOK_REFERER: &str = "https://www.tiktok.com/";

#[derive(Debug, Clone)]
pub struct TikTokSound {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub play_url: String,
    pub play_ext: String,
    pub thumbnail: String,
    pub duration_ms: u64,
    pub video_count: Option<u64>,
    pub webpage_url: String,
}

pub fn is_tiktok_sound_url(url: &str) -> bool {
    url.to_ascii_lowercase().contains("tiktok.com/music/")
}

/// Extract the numeric music ID from `https://www.tiktok.com/music/two-faced-7689607970291828737`.
pub fn extract_music_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segments: Vec<&str> = parsed
        .path_segments()?
        .filter(|s| !s.is_empty())
        .collect();
    let idx = segments.iter().position(|s| *s == "music")?;
    let slug = segments.get(idx + 1)?;
    let tail = slug.rsplit('-').next().unwrap_or(slug);
    if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
        Some(tail.to_string())
    } else {
        None
    }
}

fn title_from_slug(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segments: Vec<&str> = parsed
        .path_segments()?
        .filter(|s| !s.is_empty())
        .collect();
    let idx = segments.iter().position(|s| *s == "music")?;
    let slug = segments.get(idx + 1)?;
    let without_id = match slug.rsplit_once('-') {
        Some((head, tail)) if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) => head,
        _ => slug,
    };
    let clean = without_id.replace('-', " ").trim().to_string();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
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
        play_ext: "mp3".to_string(),
        thumbnail,
        duration_ms: duration_secs.saturating_mul(1000),
        video_count,
        webpage_url: webpage_url.to_string(),
    })
}

async fn fetch_oembed_title_and_author(client: &reqwest::Client, url: &str) -> (Option<String>, Option<String>) {
    let Ok(mut oembed_url) = url::Url::parse("https://www.tiktok.com/oembed") else {
        return (None, None);
    };
    oembed_url.query_pairs_mut().append_pair("url", url);
    let Ok(resp) = client
        .get(oembed_url)
        .header("User-Agent", TIKTOK_USER_AGENT)
        .send()
        .await
    else {
        return (None, None);
    };
    if !resp.status().is_success() {
        return (None, None);
    }
    let Ok(json) = resp.json::<Value>().await else {
        return (None, None);
    };
    let raw_title = str_field(&json, "title").map(|t| {
        t.trim_start_matches('♬')
            .trim()
            .to_string()
    });
    let author = str_field(&json, "author_name");
    (raw_title, author)
}

/// Resolve a TikTok `/music/...` sound via TikTok's official `/embed/music/<id>` Frontity state
/// (and oEmbed for clean title), with `__UNIVERSAL_DATA_FOR_REHYDRATION__` checked as a fallback.
pub async fn resolve_sound(url: &str) -> Result<TikTokSound, CommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| CommandError::new("HTTP_ERROR", format!("HTTP client error: {e}")))?;

    // 1. Primary path: TikTok's official `/embed/music/<id>` endpoint (returns 200 JSON state reliably).
    if let Some(music_id) = extract_music_id(url) {
        let embed_url = format!("https://www.tiktok.com/embed/music/{music_id}");
        if let Ok(resp) = client
            .get(&embed_url)
            .header("User-Agent", TIKTOK_USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Referer", TIKTOK_REFERER)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(html) = resp.text().await {
                    if let Some(raw_state) = extract_script_json(&html, "__FRONTITY_CONNECT_STATE__") {
                        if let Ok(state) = serde_json::from_str::<Value>(raw_state) {
                            if let Some(entry) = state
                                .get("source")
                                .and_then(|s| s.get("data"))
                                .and_then(|d| d.as_object())
                                .and_then(|map| map.values().next())
                            {
                                let embed_info = entry.get("embedInfo");
                                let artist = embed_info.and_then(|e| str_field(e, "artist"));
                                let cover = embed_info
                                    .and_then(|e| str_field(e, "coverUrl"))
                                    .unwrap_or_default();
                                let video_count = embed_info.and_then(|e| u64_field(e, "videoCount"));

                                // Pick the first playable video stream using this sound.
                                let play_url = entry
                                    .get("videoList")
                                    .and_then(|v| v.as_array())
                                    .and_then(|list| {
                                        list.iter().find_map(|item| str_field(item, "playAddr"))
                                    });

                                if let Some(play_url) = play_url {
                                    let (oembed_title, oembed_author) =
                                        fetch_oembed_title_and_author(&client, url).await;
                                    let title = oembed_title
                                        .or_else(|| title_from_slug(url))
                                        .unwrap_or_else(|| format!("TikTok Sound {music_id}"));
                                    let author = artist.or(oembed_author);
                                    return Ok(TikTokSound {
                                        id: music_id,
                                        title,
                                        author,
                                        play_url,
                                        play_ext: "mp4".to_string(),
                                        thumbnail: cover,
                                        duration_ms: 0,
                                        video_count,
                                        webpage_url: url.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback path: direct `/music/...` HTML rehydration data if available.
    if let Ok(resp) = client
        .get(url)
        .header("User-Agent", TIKTOK_USER_AGENT)
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", TIKTOK_REFERER)
        .send()
        .await
    {
        let final_url = resp.url().to_string();
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                if let Some(raw) = extract_script_json(&html, "__UNIVERSAL_DATA_FOR_REHYDRATION__") {
                    if let Ok(json) = serde_json::from_str::<Value>(raw) {
                        if let Some(sound) = parse_music_from_universal_data(&json, &final_url) {
                            return Ok(sound);
                        }
                    }
                }
            }
        }
    }

    Err(CommandError::new(
        "TIKTOK_SOUND_NOT_FOUND",
        "Could not load this TikTok sound. It may be private, removed, or region-restricted.",
    ))
}

async fn probe_remote_duration_ms(url: &str, settings: &Settings) -> Option<u64> {
    let ffprobe = binaries::resolve(Tool::Ffprobe, settings)?;
    let headers = format!(
        "Referer: {}\r\nUser-Agent: {}\r\n",
        TIKTOK_REFERER, TIKTOK_USER_AGENT
    );
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-headers".into(),
        headers,
        "-show_entries".into(),
        "format=duration".into(),
        "-of".into(),
        "default=noprint_wrappers=1:nokey=1".into(),
        url.to_string(),
    ];
    let output = process_manager::run_capture(&ffprobe, &args, Duration::from_secs(12))
        .await
        .ok()?;
    if !output.success {
        return None;
    }
    let secs: f64 = output.stdout.trim().parse().ok()?;
    if secs.is_finite() && secs > 0.0 {
        Some((secs * 1000.0).round() as u64)
    } else {
        None
    }
}

/// Probe a TikTok `/music/...` URL into `VideoInfo` with a localhost-proxied audio preview stream.
pub async fn probe_sound(url: &str, settings: &Settings) -> Result<VideoInfo, CommandError> {
    let sound = resolve_sound(url).await?;
    let duration_ms = if sound.duration_ms > 0 {
        sound.duration_ms
    } else {
        probe_remote_duration_ms(&sound.play_url, settings)
            .await
            .unwrap_or(30_000)
    };

    let proxied_stream = stream_proxy::register_with_headers(
        sound.play_url.clone(),
        Some(TIKTOK_USER_AGENT.to_string()),
        Some(TIKTOK_REFERER.to_string()),
        None,
        &sound.play_ext,
    )
    .ok();

    Ok(VideoInfo {
        id: sound.id,
        source: VideoSource::Tiktok,
        title: sound.title,
        duration_ms,
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
