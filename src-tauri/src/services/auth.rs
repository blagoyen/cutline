use std::path::Path;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

use crate::error::{CmdResult, CommandError};
use crate::models::Settings;
use crate::services::{binaries, process_manager, yt_dlp};
use crate::services::binaries::Tool;

/// Public video used to test browser auth.
const TEST_URL: &str = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTestResult {
    pub ok: bool,
    pub browser: String,
    pub source: Option<String>,
    pub video_title: Option<String>,
    pub code: Option<String>,
    pub message: String,
    /// Tail of yt-dlp's own output, for diagnosis only. Never contains cookie values.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileInfo {
    pub browser: String,
    pub installed: bool,
    pub data_dir: Option<String>,
    pub profiles: Vec<BrowserProfile>,
}

/// Find a browser's user-data directory.
fn user_data_dir(browser: &str) -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    match browser {
        "chrome" => local.map(|p| p.join("Google").join("Chrome").join("User Data")),
        "edge" => local.map(|p| p.join("Microsoft").join("Edge").join("User Data")),
        "brave" => local.map(|p| p.join("BraveSoftware").join("Brave-Browser").join("User Data")),
        "chromium" => local.map(|p| p.join("Chromium").join("User Data")),
        "firefox" => roaming.map(|p| p.join("Mozilla").join("Firefox").join("Profiles")),
        _ => None,
    }
}

fn firefox_profiles(dir: &PathBuf) -> Vec<BrowserProfile> {
    let ini = dir.join("profiles.ini");
    let Ok(text) = std::fs::read_to_string(ini) else {
        return Vec::new();
    };

    let mut profiles = Vec::new();
    let mut name: Option<String> = None;
    let mut path: Option<String> = None;

    let mut flush = |name: &mut Option<String>, path: &mut Option<String>| {
        if let (Some(label), Some(folder)) = (name.take(), path.take()) {
            if !label.is_empty() && !folder.is_empty() {
                profiles.push(BrowserProfile {
                    value: label.clone(),
                    label: label,
                });
            }
        }
    };

    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            flush(&mut name, &mut path);
            continue;
        }
        if let Some(value) = line.strip_prefix("Name=") {
            name = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("Path=") {
            path = Some(value.trim().to_string());
        }
    }
    flush(&mut name, &mut path);
    profiles.sort_by(|a, b| a.label.cmp(&b.label));
    profiles
}

/// Discover profile names that can be passed to `--cookies-from-browser`.
pub fn browser_profiles(browser: &str) -> BrowserProfileInfo {
    let browser = crate::models::settings::normalize_auth_browser(browser);
    let Some(dir) = user_data_dir(&browser) else {
        return BrowserProfileInfo {
            browser,
            installed: false,
            data_dir: None,
            profiles: Vec::new(),
        };
    };
    let installed = dir.is_dir();

    let mut profiles = if browser == "firefox" {
        firefox_profiles(&dir)
    } else {
        let mut found: Vec<BrowserProfile> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_profile = name == "Default"
                    || (name.starts_with("Profile ") && name[8..].chars().all(|c| c.is_ascii_digit()));
                if is_profile && entry.path().is_dir() {
                    found.push(BrowserProfile {
                        value: name.clone(),
                        label: if name == "Default" {
                            "Default profile".to_string()
                        } else {
                            name
                        },
                    });
                }
            }
        }
        found.sort_by(|a, b| a.value.cmp(&b.value));
        found
    };

    profiles.insert(
        0,
        BrowserProfile {
            value: String::new(),
            label: "Most recently used profile (default)".to_string(),
        },
    );

    BrowserProfileInfo {
        browser,
        installed,
        data_dir: dir.is_dir().then(|| dir.to_string_lossy().into_owned()),
        profiles,
    }
}

/// Storyboard-only results are not usable for downloads.
async fn only_storyboards(bin: &Path, settings: &Settings, url: &str) -> bool {
    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--list-formats".into(),
        "--extractor-retries".into(),
        "0".into(),
        "--socket-timeout".into(),
        "20".into(),
    ];
    yt_dlp::auth_args(settings, &mut args);
    args.push("--".into());
    args.push(url.to_string());

    let Ok(output) = process_manager::run_capture(bin, &args, std::time::Duration::from_secs(60)).await else {
        return false;
    };
    if !output.success {
        return false;
    }
    let text = format!("{}\n{}", output.stdout, output.stderr).to_lowercase();
    text.contains("storyboard")
        && !["mp4", "webm", "m4a", "opus", "h264", "avc1", "vp9"]
            .iter()
            .any(|marker| text.contains(marker))
}

/// Verify browser auth by fetching video metadata.
pub async fn test_authentication(settings: &Settings, url: Option<String>) -> CmdResult<AuthTestResult> {
    let source = yt_dlp::cookie_source(settings).ok_or_else(|| {
        CommandError::new(
            "AUTH_NOT_ENABLED",
            "Enable browser authentication and choose a browser first.",
        )
    })?;

    let bin = binaries::resolve(Tool::YtDlp, settings).ok_or_else(|| {
        CommandError::new("YTDLP_MISSING", "yt-dlp was not found. Set its path in Settings.")
    })?;

    if let Some(dir) = settings.pot_plugin_dir.as_deref() {
        if !Path::new(dir).is_dir() {
            return Err(CommandError::new(
                "PLUGIN_DIR_NOT_FOUND",
                "That PO Token provider folder does not exist. Install the plugin or clear the field.",
            ));
        }
    }

    let target = url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| TEST_URL.to_string());
    let (canonical, _) = yt_dlp::canonicalize(&target)?;

    // `-J` fetches real metadata without running format selection. `--print`
    // invokes selection and reports "Requested format is not available" even
    // when cookies work, which made successful sessions look like failures.
    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-progress".into(),
        "-J".into(),
        "--extractor-retries".into(),
        "0".into(),
        "--socket-timeout".into(),
        "20".into(),
    ];
    yt_dlp::auth_args(settings, &mut args);
    args.push("--".into());
    args.push(canonical.clone());

    let output = process_manager::run_capture(&bin, &args, std::time::Duration::from_secs(60))
        .await?;

    let browser = crate::models::settings::normalize_auth_browser(&settings.auth_browser);
    let common = AuthTestResult {
        ok: false,
        browser,
        source: Some(source),
        video_title: None,
        code: None,
        message: String::new(),
        detail: None,
    };

    if output.timed_out {
        return Ok(AuthTestResult {
            code: Some("AUTH_TIMEOUT".into()),
            message: "YouTube took too long to respond. Check your connection and try again.".into(),
            ..common
        });
    }

    if !output.success {
        let error = yt_dlp::map_error_for_settings(
            &output.stderr,
            "YouTube authentication test failed.",
            settings,
        );
        let message = if error.code == "YOUTUBE_FORMATS_BLOCKED" && only_storyboards(&bin, settings, &canonical).await {
            format!(
                "YouTube returned only storyboard images for this browser session — no playable video or audio. Sign in to YouTube in {} and retry. If you are already signed in, install a PO Token provider plugin.",
                common.browser
            )
        } else {
            error.message
        };
        return Ok(AuthTestResult {
            code: Some(error.code),
            message,
            detail: error.detail,
            ..common
        });
    }

    let json: Value = match serde_json::from_slice(output.stdout.as_bytes()) {
        Ok(value) => value,
        Err(_) => {
            return Ok(AuthTestResult {
                code: Some("AUTH_NO_METADATA".into()),
                message: "yt-dlp could not read video metadata. Try a different test video.".into(),
                ..common
            });
        }
    };

    let title = json
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let Some(title) = title else {
        return Ok(AuthTestResult {
            code: Some("AUTH_NO_METADATA".into()),
            message: "yt-dlp could not read a video title. Try a different test video.".into(),
            ..common
        });
    };

    // Storyboard-only results do not count as successful auth.
    let formats = json.get("formats").and_then(|value| value.as_array());
    let has_video = formats.map(|items| {
        items.iter().any(|item| {
            item.get("vcodec").and_then(Value::as_str) != Some("none")
                && item.get("height").and_then(Value::as_u64).unwrap_or(0) > 0
        })
    }).unwrap_or(false);
    let has_audio = formats.map(|items| {
        items.iter().any(|item| item.get("acodec").and_then(Value::as_str) != Some("none"))
    }).unwrap_or(false);

    if !has_video || !has_audio {
        return Ok(AuthTestResult {
            code: Some("YOUTUBE_FORMATS_BLOCKED".into()),
            message: format!(
                "The browser session can read video info, but YouTube returned no playable video/audio streams (usually only storyboard images). Sign in to YouTube in {} and retry. If you are already signed in, install a PO Token provider plugin.",
                common.browser
            ),
            video_title: Some(title),
            ..common
        });
    }

    Ok(AuthTestResult {
        ok: true,
        video_title: Some(title),
        message: "Browser authentication works. YouTube metadata and playable formats were retrieved with your browser session.".into(),
        ..common
    })
}
