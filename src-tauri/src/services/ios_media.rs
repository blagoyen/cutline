use serde_json::{json, Value};

use crate::error::CommandError;
use crate::models::video::{Chapter, FormatInfo, VideoInfo, VideoSource};
use crate::services::binaries::{DependencyInfo, DependencyReport};

const TWITCH_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const IOS_UA: &str =
    "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)";

/// On iOS, cutting and extraction run 100% in-process (AVFoundation + Rust HTTP),
/// so desktop CLI binaries (yt-dlp / FFmpeg / FFprobe) are not needed.
#[allow(dead_code)]
pub fn ios_dependency_report() -> DependencyReport {
    let make = |name: &str, version: &str| DependencyInfo {
        name: name.to_string(),
        found: true,
        ready: true,
        path: Some("built-in".to_string()),
        version: Some(version.to_string()),
        source: "ios-native".to_string(),
        error: None,
    };
    DependencyReport {
        yt_dlp: make("Extractor", "On-Device (YouTube + Twitch)"),
        ffmpeg: make("AVFoundation", "iOS Hardware Muxer"),
        ffprobe: make("AVAsset", "iOS Media Inspector"),
        ready: true,
    }
}

fn http_client() -> Result<reqwest::Client, CommandError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|err| {
            CommandError::new("HTTP_CLIENT_ERROR", "Could not initialize network client.")
                .with_detail(err.to_string())
        })
}

/// Probe a canonical YouTube or Twitch URL directly on-device without spawning yt-dlp.
#[allow(dead_code)]
pub async fn probe(canonical_url: &str) -> Result<VideoInfo, CommandError> {
    let lower = canonical_url.to_lowercase();
    if lower.contains("twitch.tv/videos/") {
        let id = canonical_url
            .split("/videos/")
            .nth(1)
            .and_then(|s| s.split(&['?', '#', '/'][..]).next())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid Twitch VOD URL."))?;
        probe_twitch_vod(id, canonical_url).await
    } else if lower.contains("clips.twitch.tv/") || lower.contains("/clip/") {
        let slug = canonical_url
            .rsplit('/')
            .next()
            .and_then(|s| s.split(&['?', '#'][..]).next())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid Twitch Clip URL."))?;
        probe_twitch_clip(slug, canonical_url).await
    } else {
        let id = extract_youtube_id(canonical_url)
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid YouTube URL."))?;
        probe_youtube(&id, canonical_url).await
    }
}

fn extract_youtube_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "v") {
        let s = v.trim();
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    parsed
        .path_segments()
        .and_then(|segs| segs.filter(|s| !s.is_empty()).last())
        .map(|s| s.to_string())
}

async fn probe_twitch_vod(vod_id: &str, canonical_url: &str) -> Result<VideoInfo, CommandError> {
    let client = http_client()?;
    let query = json!([
        {
            "query": format!(
                "query {{ video(id: \"{}\") {{ id title lengthSeconds viewCount createdAt previewThumbnailURL(height: 720, width: 1280) owner {{ displayName }} }} }}",
                vod_id
            )
        },
        {
            "query": format!(
                "query {{ videoPlaybackAccessToken(id: \"{}\", params: {{ platform: \"web\", playerBackend: \"mediaplayer\", playerType: \"site\" }}) {{ value signature }} }}",
                vod_id
            )
        }
    ]);

    let resp = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", TWITCH_CLIENT_ID)
        .json(&query)
        .send()
        .await
        .map_err(|err| {
            CommandError::new("TWITCH_FETCH_FAILED", "Could not reach Twitch.")
                .with_detail(err.to_string())
        })?;

    let payload: Value = resp.json().await.map_err(|err| {
        CommandError::new("TWITCH_PARSE_FAILED", "Could not parse Twitch metadata.")
            .with_detail(err.to_string())
    })?;

    let video = payload
        .get(0)
        .and_then(|r| r.pointer("/data/video"))
        .filter(|v| !v.is_null())
        .ok_or_else(|| {
            CommandError::new("VIDEO_NOT_FOUND", "Twitch VOD not found or no longer available.")
        })?;

    let token = payload
        .get(1)
        .and_then(|r| r.pointer("/data/videoPlaybackAccessToken"))
        .filter(|v| !v.is_null())
        .ok_or_else(|| {
            CommandError::new(
                "SUBSCRIBER_ONLY",
                "Could not obtain Twitch playback token. This VOD may be subscriber-only.",
            )
        })?;

    let token_val = token.get("value").and_then(|v| v.as_str()).unwrap_or_default();
    let token_sig = token
        .get("signature")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let mut master = url::Url::parse(&format!("https://usher.ttvnw.net/vod/{vod_id}.m3u8"))
        .map_err(|err| CommandError::new("URL_ERROR", err.to_string()))?;
    master
        .query_pairs_mut()
        .append_pair("nauth", token_val)
        .append_pair("nauthsig", token_sig)
        .append_pair("allow_source", "true")
        .append_pair("allow_audio_only", "true")
        .append_pair("player", "twitchweb");

    let master_url = master.to_string();
    let heights = parse_hls_heights(&client, &master_url).await;

    let title = video
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Twitch VOD")
        .to_string();
    let duration_ms = video
        .get("lengthSeconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        * 1000;
    let uploader = video
        .pointer("/owner/displayName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let thumbnail = video
        .get("previewThumbnailURL")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let view_count = video.get("viewCount").and_then(|v| v.as_u64());
    let upload_date = video
        .get("createdAt")
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(10).collect());

    let formats: Vec<FormatInfo> = heights
        .iter()
        .map(|&h| FormatInfo {
            format_id: format!("{h}p"),
            ext: "mp4".into(),
            height: Some(h),
            width: None,
            fps: None,
            vcodec: Some("avc1".into()),
            acodec: Some("mp4a".into()),
            filesize: None,
            note: Some(format!("{h}p HLS")),
        })
        .collect();

    Ok(VideoInfo {
        id: vod_id.to_string(),
        source: VideoSource::Twitch,
        title,
        uploader,
        duration_ms,
        thumbnail,
        webpage_url: canonical_url.to_string(),
        stream_url: Some(master_url),
        view_count,
        upload_date,
        is_live: false,
        formats,
        max_height: heights.first().copied().unwrap_or(0),
        heights,
        chapters: Vec::new(),
    })
}

async fn probe_twitch_clip(slug: &str, canonical_url: &str) -> Result<VideoInfo, CommandError> {
    let client = http_client()?;
    let query = json!({
        "query": format!(
            "query {{ clip(slug: \"{}\") {{ id slug title durationSeconds viewCount createdAt thumbnailURL broadcaster {{ displayName }} videoQualities {{ quality sourceURL }} playbackAccessToken(params: {{ platform: \"web\", playerType: \"embed\" }}) {{ signature value }} }} }}",
            slug
        )
    });

    let resp = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", TWITCH_CLIENT_ID)
        .json(&query)
        .send()
        .await
        .map_err(|err| {
            CommandError::new("TWITCH_FETCH_FAILED", "Could not reach Twitch.")
                .with_detail(err.to_string())
        })?;

    let payload: Value = resp.json().await.map_err(|err| {
        CommandError::new("TWITCH_PARSE_FAILED", "Could not parse Twitch clip metadata.")
            .with_detail(err.to_string())
    })?;

    let clip = payload
        .pointer("/data/clip")
        .filter(|v| !v.is_null())
        .ok_or_else(|| CommandError::new("VIDEO_NOT_FOUND", "Twitch clip not found."))?;

    let sig = clip
        .pointer("/playbackAccessToken/signature")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let tok = clip
        .pointer("/playbackAccessToken/value")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let mut heights = Vec::new();
    let mut best_url: Option<String> = None;
    if let Some(quals) = clip.get("videoQualities").and_then(|v| v.as_array()) {
        for q in quals {
            let h = q
                .get("quality")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            if h > 0 && !heights.contains(&h) {
                heights.push(h);
            }
            if best_url.is_none() {
                if let Some(src) = q.get("sourceURL").and_then(|v| v.as_str()) {
                    if let Ok(mut u) = url::Url::parse(src) {
                        u.query_pairs_mut()
                            .append_pair("sig", sig)
                            .append_pair("token", tok);
                        best_url = Some(u.to_string());
                    }
                }
            }
        }
    }
    heights.sort_by(|a, b| b.cmp(a));

    let duration_ms = clip
        .get("durationSeconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        * 1000;

    Ok(VideoInfo {
        id: slug.to_string(),
        source: VideoSource::Twitch,
        title: clip
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Twitch Clip")
            .to_string(),
        uploader: clip
            .pointer("/broadcaster/displayName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        duration_ms,
        thumbnail: clip
            .get("thumbnailURL")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        webpage_url: canonical_url.to_string(),
        stream_url: best_url,
        view_count: clip.get("viewCount").and_then(|v| v.as_u64()),
        upload_date: clip
            .get("createdAt")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(10).collect()),
        is_live: false,
        formats: Vec::new(),
        max_height: heights.first().copied().unwrap_or(0),
        heights,
        chapters: Vec::new(),
    })
}

async fn probe_youtube(video_id: &str, canonical_url: &str) -> Result<VideoInfo, CommandError> {
    let client = http_client()?;
    let clients = [
        json!({
            "clientName": "IOS",
            "clientVersion": "19.45.4",
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "osName": "iPhone",
            "osVersion": "18.1.0.22B83",
            "hl": "en",
            "gl": "US"
        }),
        json!({
            "clientName": "ANDROID",
            "clientVersion": "19.45.38",
            "androidSdkVersion": 34,
            "hl": "en",
            "gl": "US"
        }),
    ];

    let mut last_reason = String::from("Could not extract YouTube stream.");

    for ctx in clients {
        let body = json!({
            "videoId": video_id,
            "context": { "client": ctx },
            "contentCheckOk": true,
            "racyCheckOk": true
        });

        let Ok(resp) = client
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("User-Agent", IOS_UA)
            .json(&body)
            .send()
            .await
        else {
            continue;
        };

        let Ok(payload) = resp.json::<Value>().await else {
            continue;
        };

        let status = payload
            .pointer("/playabilityStatus/status")
            .and_then(|v| v.as_str())
            .unwrap_or("ERROR");
        if status != "OK" {
            if let Some(reason) = payload
                .pointer("/playabilityStatus/reason")
                .and_then(|v| v.as_str())
            {
                last_reason = reason.to_string();
            }
            continue;
        }

        let details = payload.get("videoDetails").cloned().unwrap_or(Value::Null);
        let title = details
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("YouTube Video")
            .to_string();
        let uploader = details
            .get("author")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let duration_ms = details
            .get("lengthSeconds")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            * 1000;
        let is_live = details
            .get("isLiveContent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            && duration_ms == 0;
        let view_count = details
            .get("viewCount")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok());
        let thumbnail = details
            .pointer("/thumbnail/thumbnails")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let hls_url = payload
            .pointer("/streamingData/hlsManifestUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut heights = Vec::new();
        let mut formats = Vec::new();
        let mut progressive_url: Option<String> = None;

        for key in ["formats", "adaptiveFormats"] {
            if let Some(arr) = payload
                .pointer(&format!("/streamingData/{key}"))
                .and_then(|v| v.as_array())
            {
                for f in arr {
                    let h = f.get("height").and_then(|v| v.as_u64()).map(|h| h as u32);
                    if let Some(height) = h {
                        if height > 0 && !heights.contains(&height) {
                            heights.push(height);
                        }
                        if key == "formats" {
                            if let Some(u) = f.get("url").and_then(|v| v.as_str()) {
                                progressive_url = Some(u.to_string());
                            }
                        }
                        formats.push(FormatInfo {
                            format_id: f
                                .get("itag")
                                .and_then(|v| v.as_u64())
                                .map(|n| n.to_string())
                                .unwrap_or_default(),
                            ext: "mp4".into(),
                            height: Some(height),
                            width: f.get("width").and_then(|v| v.as_u64()).map(|w| w as u32),
                            fps: f.get("fps").and_then(|v| v.as_f64()),
                            vcodec: f
                                .get("mimeType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            acodec: None,
                            filesize: f
                                .get("contentLength")
                                .and_then(|v| v.as_str())
                                .and_then(|s| s.parse::<u64>().ok()),
                            note: f
                                .get("qualityLabel")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        });
                    }
                }
            }
        }
        heights.sort_by(|a, b| b.cmp(a));
        if heights.is_empty() {
            if let Some(ref hls) = hls_url {
                heights = parse_hls_heights(&client, hls).await;
            }
        }

        let stream_url = hls_url.or(progressive_url);
        let chapters: Vec<Chapter> = Vec::new();

        return Ok(VideoInfo {
            id: video_id.to_string(),
            source: VideoSource::Youtube,
            title,
            uploader,
            duration_ms,
            thumbnail,
            webpage_url: canonical_url.to_string(),
            stream_url,
            view_count,
            upload_date: None,
            is_live,
            formats,
            max_height: heights.first().copied().unwrap_or(0),
            heights,
            chapters,
        });
    }

    Err(CommandError::new("YOUTUBE_EXTRACT_FAILED", last_reason))
}

async fn parse_hls_heights(client: &reqwest::Client, master_url: &str) -> Vec<u32> {
    let Ok(resp) = client.get(master_url).send().await else {
        return vec![1080, 720];
    };
    let Ok(body) = resp.text().await else {
        return vec![1080, 720];
    };
    let mut heights = Vec::new();
    for line in body.lines() {
        if let Some(pos) = line.find("RESOLUTION=") {
            let rest = &line[pos + 11..];
            let token = rest.split(',').next().unwrap_or("");
            if let Some((_, h_str)) = token.split_once('x') {
                if let Ok(h) = h_str.trim().parse::<u32>() {
                    if h > 0 && !heights.contains(&h) {
                        heights.push(h);
                    }
                }
            }
        }
    }
    heights.sort_by(|a, b| b.cmp(a));
    if heights.is_empty() {
        vec![1080, 720]
    } else {
        heights
    }
}

/// Native iOS AVFoundation trim/merge export bridge (implemented in `CutlineMedia.swift`).
#[cfg(target_os = "ios")]
extern "C" {
    fn cutline_ios_export_clip(
        stream_url: *const std::os::raw::c_char,
        sections_json: *const std::os::raw::c_char,
        output_path: *const std::os::raw::c_char,
        format: *const std::os::raw::c_char,
        save_to_photos: bool,
        error_buf: *mut std::os::raw::c_char,
        error_buf_len: usize,
    ) -> i32;
}

#[cfg(target_os = "ios")]
pub async fn export_clip_avfoundation(
    stream_url: String,
    sections_json: String,
    output_path: String,
    format: String,
    save_to_photos: bool,
) -> Result<(), CommandError> {
    tokio::task::spawn_blocking(move || {
        use std::ffi::{CStr, CString};

        let c_url = CString::new(stream_url)
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;
        let c_sec = CString::new(sections_json)
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;
        let c_out = CString::new(output_path)
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;
        let c_fmt = CString::new(format)
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;

        let mut err_buf = vec![0i8; 1024];
        let code = unsafe {
            cutline_ios_export_clip(
                c_url.as_ptr(),
                c_sec.as_ptr(),
                c_out.as_ptr(),
                c_fmt.as_ptr(),
                save_to_photos,
                err_buf.as_mut_ptr(),
                err_buf.len(),
            )
        };

        if code == 0 {
            Ok(())
        } else {
            let msg = unsafe { CStr::from_ptr(err_buf.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            Err(CommandError::new(
                "AVFOUNDATION_EXPORT_FAILED",
                if msg.is_empty() {
                    "AVFoundation could not export this clip.".to_string()
                } else {
                    msg
                },
            ))
        }
    })
    .await
    .map_err(|e| CommandError::new("JOIN_ERROR", e.to_string()))?
}
