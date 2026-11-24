use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use tauri::Manager;

use crate::error::{CmdResult, CommandError};
use crate::models::Settings;
use crate::services::binaries::{self, Tool};

const RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const WINDOWS_BINARY: &str = "yt-dlp.exe";
const CHECKSUMS: &str = "SHA2-256SUMS";

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub path: String,
    pub version: String,
    pub previous_version: Option<String>,
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("YT-Cutter-Updater/1.9.0")
        .build()
        .map_err(|err| {
            CommandError::new("HTTP_CLIENT_FAILED", "Could not start the update check.")
                .with_detail(err.to_string())
        })
}

async fn latest_release(http: &reqwest::Client) -> CmdResult<Release> {
    let response = http
        .get(RELEASE_API)
        .send()
        .await
        .map_err(|err| {
            CommandError::new("UPDATE_CHECK_FAILED", "Could not reach the yt-dlp releases page.")
                .with_detail(err.to_string())
        })?
        .error_for_status()
        .map_err(|err| {
            CommandError::new(
                "UPDATE_CHECK_FAILED",
                "The yt-dlp releases page returned an error.",
            )
            .with_detail(err.to_string())
        })?;

    response.json::<Release>().await.map_err(|err| {
        CommandError::new("UPDATE_CHECK_FAILED", "Could not read yt-dlp release information.")
            .with_detail(err.to_string())
    })
}

fn asset_url<'a>(release: &'a Release, name: &str) -> CmdResult<&'a str> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == name)
        .map(|asset| asset.browser_download_url.as_str())
        .ok_or_else(|| {
            CommandError::new(
                "UPDATE_ASSET_MISSING",
                "The latest yt-dlp release does not include the expected Windows executable.",
            )
        })
}

async fn current_version(settings: &Settings) -> Option<String> {
    let path = binaries::resolve(Tool::YtDlp, settings)?;
    let (version, _) = binaries::tool_version(Tool::YtDlp, &path).await;
    version
}

/// Stable yt-dlp tags are zero-padded `YYYY.MM.DD` (nightlies add a time), so
/// a normalized lexicographic comparison is sufficient and avoids a semver dep.
pub fn newer(latest: &str, current: Option<&str>) -> bool {
    let normalize = |value: &str| -> String {
        value
            .trim()
            .trim_start_matches('v')
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.')
            .collect()
    };
    let latest = normalize(latest);
    let Some(current) = current else {
        return !latest.is_empty();
    };
    let current = normalize(current);
    latest > current
}

/// Check GitHub for a newer yt-dlp release.
pub async fn check(settings: &Settings) -> CmdResult<UpdateInfo> {
    let http = client()?;
    let release = latest_release(&http).await?;
    let current = current_version(settings).await;
    Ok(UpdateInfo {
        update_available: newer(&release.tag_name, current.as_deref()),
        current_version: current,
        latest_version: release.tag_name.trim_start_matches('v').to_string(),
        release_url: release.html_url,
    })
}

/// Install the Windows yt-dlp binary into the app config folder.
pub async fn install(app: &tauri::AppHandle, settings: &Settings) -> CmdResult<UpdateResult> {
    let http = client()?;
    let release = latest_release(&http).await?;
    let binary_url = asset_url(&release, WINDOWS_BINARY)?.to_string();
    let sums_url = asset_url(&release, CHECKSUMS)?.to_string();

    let binary = http
        .get(&binary_url)
        .send()
        .await
        .map_err(|err| {
            CommandError::new("UPDATE_DOWNLOAD_FAILED", "Could not download yt-dlp.").with_detail(err.to_string())
        })?
        .error_for_status()
        .map_err(|err| {
            CommandError::new("UPDATE_DOWNLOAD_FAILED", "The yt-dlp download was rejected.").with_detail(err.to_string())
        })?
        .bytes()
        .await
        .map_err(|err| {
            CommandError::new("UPDATE_DOWNLOAD_FAILED", "The yt-dlp download did not complete.").with_detail(err.to_string())
        })?;

    let sums = http
        .get(&sums_url)
        .send()
        .await
        .map_err(|err| {
            CommandError::new("CHECKSUM_UNAVAILABLE", "Could not download the release checksums.").with_detail(err.to_string())
        })?
        .error_for_status()
        .map_err(|err| {
            CommandError::new("CHECKSUM_UNAVAILABLE", "The release checksums could not be read.").with_detail(err.to_string())
        })?
        .text()
        .await
        .map_err(|err| {
            CommandError::new("CHECKSUM_UNAVAILABLE", "The release checksums could not be read.").with_detail(err.to_string())
        })?;

    let expected = sums
        .lines()
        .filter_map(|line| line.split_once("  "))
        .find(|(_, name)| name.trim() == WINDOWS_BINARY)
        .map(|(hash, _)| hash.trim().to_ascii_lowercase())
        .ok_or_else(|| {
            CommandError::new(
                "CHECKSUM_UNAVAILABLE",
                "The release does not list a checksum for yt-dlp.exe.",
            )
        })?;

    let actual = format!("{:x}", Sha256::digest(&binary));
    if actual != expected {
        return Err(CommandError::new(
            "CHECKSUM_MISMATCH",
            "The downloaded yt-dlp did not match the official checksum. Nothing was installed.",
        ));
    }

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| CommandError::new("UPDATE_DIR_ERROR", "Could not find the app data folder."))?
        .join("bin");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| CommandError::new("UPDATE_DIR_ERROR", "Could not create the update folder.").with_detail(err.to_string()))?;

    let final_path = dir.join(WINDOWS_BINARY);
    let temp_path = dir.join(format!("yt-dlp-{}.tmp", uuid::Uuid::new_v4()));
    tokio::fs::write(&temp_path, &binary)
        .await
        .map_err(|err| CommandError::new("UPDATE_INSTALL_FAILED", "Could not write the update.").with_detail(err.to_string()))?;

    let (version, version_error) = binaries::tool_version(Tool::YtDlp, &temp_path).await;
    let Some(version) = version else {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(CommandError::new(
            "UPDATE_VERIFY_FAILED",
            "The downloaded yt-dlp could not be executed. Nothing was installed.",
        )
        .with_detail(version_error.unwrap_or_default()));
    };
    if !newer(&release.tag_name, Some(&version)) && version != release.tag_name.trim_start_matches('v') {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(CommandError::new(
            "UPDATE_VERIFY_FAILED",
            "The downloaded executable reports an unexpected version. Nothing was installed.",
        ));
    }

    let previous_version = current_version(settings).await;
    if final_path.exists() {
        let backup = dir.join(format!("yt-dlp-old-{}.exe", uuid::Uuid::new_v4()));
        tokio::fs::rename(&final_path, &backup)
            .await
            .map_err(|err| CommandError::new("UPDATE_INSTALL_FAILED", "Could not replace the old yt-dlp.").with_detail(err.to_string()))?;
        if let Err(err) = tokio::fs::rename(&temp_path, &final_path).await {
            let _ = tokio::fs::rename(&backup, &final_path).await;
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(CommandError::new("UPDATE_INSTALL_FAILED", "Could not install the update.").with_detail(err.to_string()));
        }
        let _ = tokio::fs::remove_file(&backup).await;
    } else {
        tokio::fs::rename(&temp_path, &final_path)
            .await
            .map_err(|err| CommandError::new("UPDATE_INSTALL_FAILED", "Could not install the update.").with_detail(err.to_string()))?;
    }

    Ok(UpdateResult {
        path: final_path.to_string_lossy().into_owned(),
        version,
        previous_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_yt_dlp_release_versions() {
        assert!(newer("2026.11.23", Some("2026.11.22")));
        assert!(newer("2026.11.23", Some("2025.12.31")));
        assert!(!newer("2026.11.23", Some("2026.11.23")));
        assert!(newer("2026.11.23.210000", Some("2026.11.23.200000")));
        assert!(newer("2026.11.23", None));
    }
}
