use std::path::Path;
use std::time::Duration;

use url::Url;

use crate::error::CommandError;
use crate::models::video::{VideoInfo, VideoSource};
use crate::models::Settings;
use crate::services::{binaries, metadata, process_manager};
use crate::services::binaries::Tool;

const YOUTUBE_HOSTS: [&str; 6] = [
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
];

const TWITCH_HOSTS: [&str; 3] = ["twitch.tv", "m.twitch.tv", "clips.twitch.tv"];

fn invalid_url() -> CommandError {
    CommandError::new(
        "INVALID_URL",
        "Paste a supported YouTube video link or Twitch VOD / clip link.",
    )
}

fn looks_like_youtube_id(value: &str) -> bool {
    value.len() == 11
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn looks_like_twitch_vod_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.chars().all(|c| c.is_ascii_digit())
}

fn looks_like_twitch_clip_slug(value: &str) -> bool {
    value.len() >= 6
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn detect_source(url: &str) -> VideoSource {
    if url.to_ascii_lowercase().contains("twitch.tv") {
        VideoSource::Twitch
    } else {
        VideoSource::Youtube
    }
}

/// Validate a YouTube or Twitch VOD/clip link and return the canonical URL plus video id.
pub fn canonicalize(raw: &str) -> Result<(String, String), CommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "EMPTY_URL",
            "Paste a YouTube or Twitch link first.",
        ));
    }

    if looks_like_youtube_id(trimmed) {
        return Ok((
            format!("https://www.youtube.com/watch?v={}", trimmed),
            trimmed.to_string(),
        ));
    }

    let has_http_scheme = trimmed
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || trimmed
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"));
    let candidate = if has_http_scheme {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };

    let parsed = Url::parse(&candidate).map_err(|_| invalid_url())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(invalid_url());
    }
    let host = parsed
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_lowercase();

    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|part| !part.is_empty()).collect())
        .unwrap_or_default();

    if TWITCH_HOSTS.contains(&host.as_str()) {
        if host == "clips.twitch.tv" {
            let slug = segments
                .first()
                .copied()
                .filter(|value| looks_like_twitch_clip_slug(value))
                .ok_or_else(invalid_url)?;
            return Ok((
                format!("https://clips.twitch.tv/{}", slug),
                slug.to_string(),
            ));
        }

        // twitch.tv/videos/<id> or m.twitch.tv/videos/<id>
        if matches!(segments.first().copied(), Some("videos") | Some("video")) {
            let id = segments
                .get(1)
                .copied()
                .map(|s| s.strip_prefix('v').unwrap_or(s))
                .filter(|value| looks_like_twitch_vod_id(value))
                .ok_or_else(invalid_url)?;
            return Ok((
                format!("https://www.twitch.tv/videos/{}", id),
                id.to_string(),
            ));
        }

        // twitch.tv/<channel>/video/<id> or twitch.tv/<channel>/videos/<id>
        if matches!(segments.get(1).copied(), Some("video") | Some("videos")) {
            if let Some(id) = segments
                .get(2)
                .copied()
                .map(|s| s.strip_prefix('v').unwrap_or(s))
                .filter(|value| looks_like_twitch_vod_id(value))
            {
                return Ok((
                    format!("https://www.twitch.tv/videos/{}", id),
                    id.to_string(),
                ));
            }
        }

        // twitch.tv/<channel>/clip/<slug>
        if segments.get(1).copied() == Some("clip") {
            let channel = segments.first().copied().ok_or_else(invalid_url)?;
            let slug = segments
                .get(2)
                .copied()
                .filter(|value| looks_like_twitch_clip_slug(value))
                .ok_or_else(invalid_url)?;
            return Ok((
                format!("https://www.twitch.tv/{}/clip/{}", channel, slug),
                slug.to_string(),
            ));
        }

        return Err(CommandError::new(
            "INVALID_URL",
            "Paste a Twitch VOD link (twitch.tv/videos/...) or Twitch clip link. Live channels cannot be clipped.",
        ));
    }

    if !YOUTUBE_HOSTS.contains(&host.as_str())
        && !YOUTUBE_HOSTS.contains(&format!("www.{}", host).as_str())
        && host != "www.youtu.be"
    {
        return Err(invalid_url());
    }

    let id = if host == "youtu.be" {
        segments.first().map(|s| s.to_string())
    } else if segments.first() == Some(&"watch") {
        parsed
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.to_string())
    } else {
        match segments.first().copied() {
            Some("shorts") | Some("embed") | Some("live") | Some("v") => {
                segments.get(1).map(|s| s.to_string())
            }
            _ => None,
        }
    };

    let id = id
        .filter(|value| looks_like_youtube_id(value))
        .ok_or_else(invalid_url)?;
    Ok((
        format!("https://www.youtube.com/watch?v={}", id),
        id,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_watch_short_shorts_and_embed_links() {
        let cases = [
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"),
            ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ];
        for (input, expected) in cases {
            let (url, id) = canonicalize(input).unwrap();
            assert_eq!(id, expected, "{input}");
            assert_eq!(url, format!("https://www.youtube.com/watch?v={expected}"));
        }
    }

    #[test]
    fn accepts_twitch_vod_and_clip_links() {
        let (url, id) = canonicalize("https://www.twitch.tv/videos/2145678901?t=01h02m03s").unwrap();
        assert_eq!(url, "https://www.twitch.tv/videos/2145678901");
        assert_eq!(id, "2145678901");

        let (url, id) = canonicalize("m.twitch.tv/videos/2145678901").unwrap();
        assert_eq!(url, "https://www.twitch.tv/videos/2145678901");
        assert_eq!(id, "2145678901");

        let (url, id) = canonicalize("https://www.twitch.tv/somechannel/video/2145678901").unwrap();
        assert_eq!(url, "https://www.twitch.tv/videos/2145678901");
        assert_eq!(id, "2145678901");

        let (url, id) = canonicalize("https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage").unwrap();
        assert_eq!(url, "https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage");
        assert_eq!(id, "AwkwardHelplessSalamanderSwiftRage");

        assert!(canonicalize("https://www.twitch.tv/somechannel").is_err());
    }

    #[test]
    fn rejects_empty_invalid_and_non_youtube_links() {
        for input in ["", "   ", "https://example.com/watch?v=dQw4w9WgXcQ", "ftp://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short"] {
            assert!(canonicalize(input).is_err(), "{input}");
        }
    }

    #[test]
    fn format_selector_caps_resolution_and_prefers_mp4() {
        let best = format_selector("best");
        assert!(best.contains("ext=mp4"));
        assert!(best.contains("ext=m4a"));
        let hd = format_selector("720p");
        assert!(hd.contains("height<=720"));
        assert!(hd.contains("ext=mp4"));
    }

    #[test]
    fn auth_args_are_central_and_only_added_when_enabled() {
        let mut settings = Settings::default();
        let mut args: Vec<String> = Vec::new();
        auth_args(&settings, &mut args);
        assert_eq!(args, ["--js-runtimes", "node"]);

        settings.auth_enabled = true;
        settings.auth_browser = "edge".into();
        let mut args: Vec<String> = Vec::new();
        auth_args(&settings, &mut args);
        assert_eq!(args, ["--js-runtimes", "node", "--cookies-from-browser", "edge"]);

        settings.auth_browser = "chrome".into();
        settings.auth_profile = Some("Profile 1".into());
        let mut args: Vec<String> = Vec::new();
        auth_args(&settings, &mut args);
        assert_eq!(
            args,
            ["--js-runtimes", "node", "--cookies-from-browser", "chrome:Profile 1"]
        );

        let plugin_dir = std::env::temp_dir().to_string_lossy().into_owned();
        settings.pot_plugin_dir = Some(plugin_dir.clone());
        let mut args: Vec<String> = Vec::new();
        auth_args(&settings, &mut args);
        assert_eq!(
            args,
            [
                "--js-runtimes",
                "node",
                "--cookies-from-browser",
                "chrome:Profile 1",
                "--plugin-dirs",
                "default",
                "--plugin-dirs",
                plugin_dir.as_str()
            ]
        );
    }

    #[test]
    fn error_mapping_distinguishes_auth_failures() {
        let cases = [
            ("could not find 'cookies.sqlite'", "COOKIES_UNAVAILABLE"),
            ("database is locked", "BROWSER_DB_LOCKED"),
            ("profile Default is not found", "BROWSER_PROFILE_MISSING"),
            ("unsupported browser", "BROWSER_NOT_FOUND"),
            ("po token required", "PO_TOKEN_REQUIRED"),
            ("your yt-dlp version is out of date", "YTDLP_OUTDATED"),
            ("sign in to confirm you're not a bot", "SIGN_IN_REQUIRED"),
            ("n challenge solving failed", "JS_RUNTIME_MISSING"),
            ("no video formats found", "YOUTUBE_FORMATS_BLOCKED"),
            ("private video", "PRIVATE_VIDEO"),
            ("age-restricted video", "AGE_RESTRICTED"),
            ("getaddrinfo failed", "NETWORK_ERROR"),
        ];
        for (stderr, code) in cases {
            assert_eq!(map_error(stderr, "context", false).code, code, "{stderr}");
        }

        let mut settings = Settings::default();
        settings.auth_enabled = true;
        settings.auth_profile = Some("Profile 9".into());
        assert_eq!(
            map_error_for_settings("could not find cookies database in ...", "context", &settings).code,
            "BROWSER_PROFILE_MISSING"
        );

        let mut plain = Settings::default();
        plain.auth_enabled = false;
        assert_eq!(
            map_error_for_settings("requested format is not available", "context", &plain).code,
            "FORMAT_UNAVAILABLE"
        );
        assert_eq!(
            map_error_for_settings("requested format is not available", "context", &settings).code,
            "YOUTUBE_FORMATS_BLOCKED"
        );
    }
}

/// Build the `--cookies-from-browser` value, if auth is enabled.
pub fn cookie_source(settings: &Settings) -> Option<String> {
    if !settings.auth_enabled {
        return None;
    }
    use crate::models::settings::normalize_auth_browser;
    let browser = normalize_auth_browser(&settings.auth_browser);
    if browser == "none" {
        return None;
    }
    let mut source = browser;
    if let Some(profile) = settings
        .auth_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        source.push(':');
        source.push_str(profile);
    }
    Some(source)
}

/// Add yt-dlp args for a specific video source (YouTube gets JS runtime + PO Token;
/// both YouTube and Twitch use browser cookies when authentication is enabled).
pub fn auth_args_for_url(settings: &Settings, url: &str, args: &mut Vec<String>) {
    let source = detect_source(url);
    if source == VideoSource::Youtube {
        args.push("--js-runtimes".into());
        args.push("node".into());
    }
    if let Some(source_cookies) = cookie_source(settings) {
        args.push("--cookies-from-browser".into());
        args.push(source_cookies);
    }
    if source == VideoSource::Youtube {
        if let Some(dir) = settings
            .pot_plugin_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && Path::new(value).is_dir())
        {
            args.push("--plugin-dirs".into());
            args.push("default".into());
            args.push("--plugin-dirs".into());
            args.push(dir.to_string());
        }
    }
}

/// Add YouTube-specific yt-dlp args: JS runtime, auth, and PO Token plugin.
pub fn auth_args(settings: &Settings, args: &mut Vec<String>) {
    auth_args_for_url(settings, "https://www.youtube.com/watch?v=jNQXAC9IVRw", args);
}

/// Prefer MP4/M4A streams so the merged result is broadly playable.
pub fn format_selector(quality: &str) -> String {
    match quality {
        "best" => "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b".to_string(),
        "worst" => "wv*+wa/w".to_string(),
        other => {
            let height: u32 = other.trim_end_matches('p').parse().unwrap_or(1080);
            format!(
                "bv*[height<={h}][ext=mp4]+ba[ext=m4a]/bv*[height<={h}]+ba/b[height<={h}]/b",
                h = height
            )
        }
    }
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else if ch != '\r' {
            output.push(ch);
        }
    }
    output
}

fn tail_cleaned(cleaned: &str, lines: usize) -> String {
    let mut collected: Vec<&str> = cleaned
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    if collected.len() > lines {
        collected = collected.split_off(collected.len() - lines);
    }
    collected.join("\n")
}

pub fn tail(text: &str, lines: usize) -> String {
    let cleaned = strip_ansi(text);
    tail_cleaned(&cleaned, lines)
}

/// Map yt-dlp errors to a user-facing message.
pub fn map_error(stderr: &str, exit_context: &str, auth_enabled: bool) -> CommandError {
    let cleaned = strip_ansi(stderr);
    let lower = cleaned.to_lowercase();
    let detail = tail_cleaned(&cleaned, 8);

    let (code, message): (&str, &str) = if lower.contains("n challenge solving failed")
        || lower.contains("no js runtimes")
        || lower.contains("javascript runtime")
        || lower.contains("challenge solver script")
        || lower.contains("js runtime executable")
    {
        (
            "JS_RUNTIME_MISSING",
            "YouTube requires Node.js 22 or newer to solve its JavaScript challenge. Install Node.js from nodejs.org, restart Cutline, and try again.",
        )
    } else if lower.contains("no video formats found") {
        (
            "YOUTUBE_FORMATS_BLOCKED",
            if auth_enabled {
                "YouTube did not return any playable formats for this session. The browser may not be signed in, or the video may need a PO Token provider. Run Test Authentication in Settings."
            } else {
                "YouTube did not return any playable formats. Enable browser authentication in Settings or try a different video."
            },
        )
    } else if lower.contains("po token")
        || lower.contains("proof of origin")
        || lower.contains("sabr")
        || lower.contains("n challenge")
    {
        (
            "PO_TOKEN_REQUIRED",
            "YouTube is requiring a Proof of Origin Token for this video. Install a yt-dlp PO Token provider plugin in Settings (optional) and try again.",
        )
    } else if lower.contains("yt-dlp is out of date")
        || lower.contains("update your yt-dlp")
        || lower.contains("your yt-dlp version")
    {
        (
            "YTDLP_OUTDATED",
            "This yt-dlp version is too old for YouTube. Open Settings → Tools and update yt-dlp.",
        )
    } else if lower.contains("database is locked")
        || lower.contains("db is locked")
        || lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("could not open")
    {
        (
            "BROWSER_DB_LOCKED",
            "The browser's cookie database is locked. Close that browser completely and try again, or choose a different profile.",
        )
    } else if (lower.contains("profile") && lower.contains("not found"))
        || (lower.contains("profile") && lower.contains("does not exist"))
    {
        (
            "BROWSER_PROFILE_MISSING",
            "The selected browser profile was not found. Check the profile name in Settings or leave it blank to use the default profile.",
        )
    } else if lower.contains("decrypt")
        || lower.contains("dpapi")
        || lower.contains("keyring")
        || (lower.contains("cookie") && lower.contains("cannot be read"))
    {
        (
            "COOKIES_DECRYPT_FAILED",
            "yt-dlp could not decrypt this browser's cookies. Restart the browser, make sure it is fully updated, and try again.",
        )
    } else if lower.contains("browser") && lower.contains("not installed")
        || lower.contains("unsupported browser")
    {
        (
            "BROWSER_NOT_FOUND",
            "That browser was not found on this computer. Choose a different browser in Settings.",
        )
    } else if lower.contains("could not find cookies")
        || lower.contains("no cookies found")
        || lower.contains("cookies from browser failed")
        || (lower.contains("cookie") && (lower.contains("could not find") || lower.contains("not found")))
    {
        (
            "COOKIES_UNAVAILABLE",
            "No usable cookies were found. Sign in to YouTube in the selected browser profile, then run Test Authentication in Settings.",
        )
    } else if lower.contains("expired") && lower.contains("cookie") {
        (
            "COOKIES_EXPIRED",
            "The browser's YouTube cookies are expired. Sign in to YouTube again in that browser, then run Test Authentication.",
        )
    } else if lower.contains("sign in to confirm") {
        if auth_enabled {
            (
                "SIGN_IN_REQUIRED",
                "YouTube still asks for sign-in confirmation. Confirm you are signed in to the selected browser profile, close and reopen the browser, then run Test Authentication in Settings.",
            )
        } else {
            (
                "SIGN_IN_REQUIRED",
                "YouTube is asking for sign-in confirmation for this video. Enable browser authentication in Settings to use your existing YouTube session.",
            )
        }
    } else if lower.contains("private video") {
        ("PRIVATE_VIDEO", "This video is private and cannot be downloaded.")
    } else if lower.contains("subscriber-only")
        || lower.contains("subscribers-only")
        || lower.contains("sub-only")
    {
        (
            "SUBSCRIBER_ONLY",
            "This Twitch VOD is subscriber-only. Enable browser authentication in Settings with a subscribed Twitch account.",
        )
    } else if lower.contains("members-only") || lower.contains("join this channel") {
        (
            "MEMBERS_ONLY",
            "This video is only available to channel members.",
        )
    } else if lower.contains("age-restricted") || lower.contains("confirm your age") {
        (
            "AGE_RESTRICTED",
            "This video is age-restricted and YouTube blocks anonymous access.",
        )
    } else if lower.contains("not available in your country")
        || lower.contains("not made this video available in your country")
        || lower.contains("geo-restricted")
    {
        (
            "GEO_BLOCKED",
            "This video is not available in your region.",
        )
    } else if lower.contains("is live") || lower.contains("live event will begin") {
        (
            "LIVE_NOT_SUPPORTED",
            "Live streams cannot be clipped. Try again once the broadcast has ended.",
        )
    } else if lower.contains("requested format is not available") {
        if auth_enabled {
            (
                "YOUTUBE_FORMATS_BLOCKED",
                "YouTube did not return a usable video/audio format for this session — this is not a quality-selection problem. Check that the browser is signed in, update yt-dlp in Settings → Tools, and retry. If it still fails, the video likely needs a PO Token provider plugin.",
            )
        } else {
            (
                "FORMAT_UNAVAILABLE",
                "The requested quality is not available for this video. Try a lower resolution or Best available. If Best available also fails, enable browser authentication in Settings.",
            )
        }
    } else if lower.contains("ffmpeg not found")
        || lower.contains("ffmpeg-location")
        || lower.contains("ffmpeg is not installed")
    {
        (
            "FFMPEG_MISSING",
            "FFmpeg is required to cut sections. Set its location in Settings.",
        )
    } else if lower.contains("no space left") || lower.contains("disk full") {
        ("DISK_FULL", "There is not enough free space on the output drive.")
    } else if lower.contains("timed out")
        || lower.contains("urlopen error")
        || lower.contains("getaddrinfo")
        || lower.contains("failed to resolve")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("connection reset")
    {
        (
            "NETWORK_ERROR",
            "Could not reach YouTube. Check your internet connection and try again.",
        )
    } else if lower.contains("http error 403") {
        (
            "ACCESS_DENIED",
            "YouTube refused the request (HTTP 403). Try again in a moment.",
        )
    } else if lower.contains("video unavailable")
        || lower.contains("this video is unavailable")
        || lower.contains("http error 404")
        || lower.contains("does not exist")
        || lower.contains("removed by the uploader")
    {
        (
            "VIDEO_UNAVAILABLE",
            "This video is unavailable. It may be private, removed, or region locked.",
        )
    } else {
        (
            "TOOL_FAILED",
            exit_context,
        )
    };

    CommandError::new(code, message).with_detail(detail)
}

/// Map profile-related auth failures separately.
pub fn map_error_for_settings(
    stderr: &str,
    exit_context: &str,
    settings: &Settings,
) -> CommandError {
    let error = map_error(stderr, exit_context, settings.auth_enabled);
    let has_profile = settings
        .auth_profile
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if error.code == "COOKIES_UNAVAILABLE" && has_profile {
        return CommandError::new(
            "BROWSER_PROFILE_MISSING",
            "The selected browser profile was not found. Check its name in Settings or leave it blank to use the most recent profile.",
        )
        .with_detail(error.detail.unwrap_or_default());
    }
    error
}

/// Fetch full metadata through `yt-dlp -J --no-playlist`.
pub async fn fetch_metadata(
    url: &str,
    settings: &Settings,
) -> Result<VideoInfo, CommandError> {
    let bin = binaries::resolve(Tool::YtDlp, settings).ok_or_else(|| {
        CommandError::new(
            "YTDLP_MISSING",
            "yt-dlp was not found. Install it or set its location in Settings.",
        )
    })?;

    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-progress".into(),
        "-J".into(),
    ];
    if let Some(ffmpeg) = binaries::resolve(Tool::Ffmpeg, settings) {
        if let Some(dir) = ffmpeg.parent() {
            args.push("--ffmpeg-location".into());
            args.push(dir.to_string_lossy().into_owned());
        }
    }
    auth_args_for_url(settings, url, &mut args);
    args.push("--".into());
    args.push(url.to_string());

    let output = process_manager::run_capture(&bin, &args, Duration::from_secs(120)).await?;
    if output.timed_out {
        return Err(CommandError::new(
            "METADATA_TIMEOUT",
            "YouTube took too long to respond. Check your connection and try again.",
        ));
    }
    if !output.success {
        return Err(map_error_for_settings(
            &output.stderr,
            "yt-dlp could not load this video.",
            settings,
        ));
    }

    let json = metadata::parse_json(output.stdout.as_bytes())?;
    metadata::parse_video_info(&json)
}
