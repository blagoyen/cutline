use serde_json::{json, Value};

use crate::error::CommandError;
use crate::models::video::{Chapter, FormatInfo, VideoInfo, VideoSource};
use crate::services::binaries::{DependencyInfo, DependencyReport};

const TWITCH_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const ANDROID_CLIENT_VERSION: &str = "20.10.38";
const ANDROID_UA: &str = "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip";
const IOS_CLIENT_VERSION: &str = "20.10.4";
const IOS_UA: &str =
    "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)";

#[allow(dead_code)]
pub struct ResolvedIosMedia {
    pub info: VideoInfo,
    pub video_url: Option<String>,
    pub audio_url: Option<String>,
    pub user_agent: Option<String>,
}

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
    Ok(probe_with_streams(canonical_url, "best").await?.info)
}

#[allow(dead_code)]
pub async fn probe_with_streams(
    canonical_url: &str,
    quality: &str,
) -> Result<ResolvedIosMedia, CommandError> {
    let lower = canonical_url.to_lowercase();
    if lower.contains("twitch.tv/videos/") {
        let id = canonical_url
            .split("/videos/")
            .nth(1)
            .and_then(|s| s.split(&['?', '#', '/'][..]).next())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid Twitch VOD URL."))?;
        let info = probe_twitch_vod(id, canonical_url).await?;
        let video_url = info.stream_url.clone();
        Ok(ResolvedIosMedia {
            info,
            video_url,
            audio_url: None,
            user_agent: None,
        })
    } else if lower.contains("clips.twitch.tv/") || lower.contains("/clip/") {
        let slug = canonical_url
            .rsplit('/')
            .next()
            .and_then(|s| s.split(&['?', '#'][..]).next())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid Twitch Clip URL."))?;
        let info = probe_twitch_clip(slug, canonical_url).await?;
        let video_url = info.stream_url.clone();
        Ok(ResolvedIosMedia {
            info,
            video_url,
            audio_url: None,
            user_agent: None,
        })
    } else {
        let id = extract_youtube_id(canonical_url)
            .ok_or_else(|| CommandError::new("INVALID_URL", "Invalid YouTube URL."))?;
        probe_youtube(&id, canonical_url, quality).await
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
        audio_stream_url: None,
        audio_only: false,
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
        audio_stream_url: None,
        audio_only: false,
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

async fn probe_youtube(
    video_id: &str,
    canonical_url: &str,
    quality: &str,
) -> Result<ResolvedIosMedia, CommandError> {
    let client = http_client()?;
    let target_height = quality.trim_end_matches('p').parse::<u32>().ok();

    // Try ANDROID first because it returns progressive `ftypmp42` MP4 (`itag 18`)
    // which plays natively inside iOS WKWebView <video> (unlike `ftypdash`), AND
    // also returns high-res H.264 + AAC adaptive formats for AVFoundation export.
    // Fall back to IOS client if ANDROID is rejected.
    let attempts = [
        (
            ANDROID_UA,
            "3",
            ANDROID_CLIENT_VERSION,
            json!({
                "clientName": "ANDROID",
                "clientVersion": ANDROID_CLIENT_VERSION,
                "androidSdkVersion": 35,
                "hl": "en",
                "gl": "US"
            }),
        ),
        (
            IOS_UA,
            "5",
            IOS_CLIENT_VERSION,
            json!({
                "clientName": "IOS",
                "clientVersion": IOS_CLIENT_VERSION,
                "deviceMake": "Apple",
                "deviceModel": "iPhone16,2",
                "osName": "iPhone",
                "osVersion": "18.3.2.22D82",
                "hl": "en",
                "gl": "US"
            }),
        ),
    ];

    let mut chosen_payload: Option<(Value, &str)> = None;
    let mut last_error = CommandError::new(
        "YOUTUBE_UNPLAYABLE",
        "This YouTube video is not playable on-device.",
    );

    for (ua, client_id, client_ver, client_ctx) in attempts {
        let body = json!({
            "videoId": video_id,
            "context": { "client": client_ctx },
            "contentCheckOk": true,
            "racyCheckOk": true
        });

        let Ok(resp) = client
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("User-Agent", ua)
            .header("X-YouTube-Client-Name", client_id)
            .header("X-YouTube-Client-Version", client_ver)
            .header("Origin", "https://www.youtube.com")
            .json(&body)
            .send()
            .await
        else {
            last_error = CommandError::new("YOUTUBE_NETWORK_ERROR", "Could not reach YouTube.");
            continue;
        };

        if !resp.status().is_success() {
            last_error = CommandError::new(
                "YOUTUBE_HTTP_ERROR",
                format!("YouTube returned HTTP {}.", resp.status().as_u16()),
            );
            continue;
        }

        let Ok(payload) = resp.json::<Value>().await else {
            last_error =
                CommandError::new("YOUTUBE_PARSE_ERROR", "Could not parse YouTube response.");
            continue;
        };

        let status = payload
            .pointer("/playabilityStatus/status")
            .and_then(|v| v.as_str())
            .unwrap_or("ERROR");
        if status == "OK" {
            chosen_payload = Some((payload, ua));
            break;
        }

        let reason = payload
            .pointer("/playabilityStatus/reason")
            .and_then(|v| v.as_str())
            .unwrap_or("This YouTube video is not playable on-device.");
        last_error = CommandError::new("YOUTUBE_UNPLAYABLE", reason);
    }

    let (payload, matched_ua) = chosen_payload.ok_or(last_error)?;

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
    let mut avc_videos: Vec<(u32, u64, String)> = Vec::new();
    let mut aac_audios: Vec<(u64, String)> = Vec::new();

    for key in ["formats", "adaptiveFormats"] {
        if let Some(arr) = payload
            .pointer(&format!("/streamingData/{key}"))
            .and_then(|v| v.as_array())
        {
            for f in arr {
                let mime = f
                    .get("mimeType")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let url_opt = f.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                let bitrate = f.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(0);

                if let Some(height) = f.get("height").and_then(|v| v.as_u64()).map(|h| h as u32) {
                    let is_h264 = mime.starts_with("video/mp4") && mime.contains("avc1");
                    if height > 0 && is_h264 && !heights.contains(&height) {
                        heights.push(height);
                    }
                    if let Some(ref u) = url_opt {
                        if key == "formats" && mime.starts_with("video/mp4") {
                            progressive_url = Some(u.clone());
                        }
                        if is_h264 {
                            avc_videos.push((height, bitrate, u.clone()));
                        }
                    }
                    if is_h264 {
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
                            vcodec: Some(mime.to_string()),
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
                } else if mime.starts_with("audio/mp4") && mime.contains("mp4a") {
                    if let Some(u) = url_opt {
                        aac_audios.push((bitrate, u));
                    }
                }
            }
        }
    }

    heights.sort_by(|a, b| b.cmp(a));
    avc_videos.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    aac_audios.sort_by(|a, b| b.0.cmp(&a.0));

    let chosen_video = if let Some(cap) = target_height {
        avc_videos
            .iter()
            .find(|(h, _, _)| *h <= cap)
            .or_else(|| avc_videos.first())
            .map(|(_, _, u)| u.clone())
    } else {
        avc_videos.first().map(|(_, _, u)| u.clone())
    };
    let chosen_audio = aac_audios.first().map(|(_, u)| u.clone());

    // iOS AVURLAsset requires progressive `ftypmp42` MP4 (itag 18) or HLS `.m3u8`
    // because Apple CoreMedia rejects raw DASH `ftypdash` adaptive MP4 over HTTP.
    let (video_url, audio_url) = if let Some(hls) = hls_url.clone() {
        (Some(hls), None)
    } else if let Some(prog) = progressive_url.clone() {
        (Some(prog), None)
    } else if let (Some(v), Some(a)) = (chosen_video, chosen_audio) {
        (Some(v), Some(a))
    } else {
        (None, None)
    };

    // For WKWebView preview: ALWAYS prefer progressive MP4 (`ftypmp42`, muxed video+audio)
    // or HLS, because iOS CoreMedia rejects raw `ftypdash` adaptive MP4 files.
    let preview_is_muxed = progressive_url.is_some() || hls_url.is_some();
    let raw_preview = progressive_url
        .clone()
        .or(hls_url.clone())
        .or(video_url.clone());
    let proxied_video = raw_preview
        .as_ref()
        .and_then(|u| {
            let ext = if u.contains("m3u8") { "m3u8" } else { "mp4" };
            crate::services::stream_proxy::register(u.clone(), Some(matched_ua.to_string()), ext)
                .ok()
        })
        .or(raw_preview);
    let proxied_audio = if preview_is_muxed {
        None
    } else {
        audio_url
            .as_ref()
            .and_then(|u| {
                crate::services::stream_proxy::register(
                    u.clone(),
                    Some(matched_ua.to_string()),
                    "m4a",
                )
                .ok()
            })
            .or_else(|| audio_url.clone())
    };

    let chapters: Vec<Chapter> = Vec::new();
    let info = VideoInfo {
        id: video_id.to_string(),
        source: VideoSource::Youtube,
        title,
        uploader,
        duration_ms,
        thumbnail,
        webpage_url: canonical_url.to_string(),
        stream_url: proxied_video,
        audio_stream_url: proxied_audio,
        audio_only: false,
        view_count,
        upload_date: None,
        is_live,
        formats,
        max_height: heights.first().copied().unwrap_or(0),
        heights,
        chapters,
    };

    Ok(ResolvedIosMedia {
        info,
        video_url,
        audio_url,
        user_agent: Some(matched_ua.to_string()),
    })
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
        video_url: *const std::os::raw::c_char,
        audio_url: *const std::os::raw::c_char,
        user_agent: *const std::os::raw::c_char,
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
    video_url: String,
    audio_url: Option<String>,
    user_agent: Option<String>,
    sections_json: String,
    output_path: String,
    format: String,
    save_to_photos: bool,
) -> Result<(), CommandError> {
    tokio::task::spawn_blocking(move || {
        use std::ffi::{CStr, CString};

        let c_vurl = CString::new(video_url)
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;
        let c_aurl = CString::new(audio_url.unwrap_or_default())
            .map_err(|e| CommandError::new("INVALID_ARG", e.to_string()))?;
        let c_ua = CString::new(user_agent.unwrap_or_default())
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
                c_vurl.as_ptr(),
                c_aurl.as_ptr(),
                c_ua.as_ptr(),
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
