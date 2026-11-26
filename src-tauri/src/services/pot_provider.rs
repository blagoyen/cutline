use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;
use tokio::net::TcpStream;
use tokio::process::Command;
use zip::ZipArchive;

use crate::error::{CmdResult, CommandError};
use crate::models::Settings;
use crate::services::process_manager;
use crate::util::lock;

/// The version this installer is pinned to. Its plugin checksum comes from the
/// GitHub release API; the source archive checksum is pinned below.
const PROVIDER_TAG: &str = "2.0.2";
const SOURCE_SHA256: &str = "df68ee6210e4960757bceae298927fb2ebd4d5cd9d390f9ff3a8287b0d2d1054";
const RELEASE_API: &str =
    "https://api.github.com/repos/Brainicism/bgutil-ytdlp-pot-provider/releases/latest";
const LOCAL_URL: &str = "127.0.0.1:4416";

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    digest: Option<String>,
    browser_download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub installed: bool,
    pub running: bool,
    pub enabled: bool,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInstall {
    pub plugin_dir: String,
    pub server_dir: String,
    pub version: String,
    pub status: ProviderStatus,
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("Cutline-Updater/2.5.0")
        .build()
        .map_err(|err| CommandError::new("HTTP_CLIENT_FAILED", "Could not start the provider installer.").with_detail(err.to_string()))
}

async fn release(http: &reqwest::Client) -> CmdResult<Release> {
    http.get(RELEASE_API)
        .send()
        .await
        .map_err(|err| CommandError::new("PROVIDER_CHECK_FAILED", "Could not reach the provider's GitHub release.").with_detail(err.to_string()))?
        .error_for_status()
        .map_err(|err| CommandError::new("PROVIDER_CHECK_FAILED", "The provider release page returned an error.").with_detail(err.to_string()))?
        .json::<Release>()
        .await
        .map_err(|err| CommandError::new("PROVIDER_CHECK_FAILED", "Could not read provider release information.").with_detail(err.to_string()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Join an archive entry to a destination without allowing path traversal.
fn safe_path(base: &Path, raw: &str, strip_first: bool) -> Option<PathBuf> {
    let normalized = raw.replace('\\', "/");
    let mut parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if strip_first {
        if parts.is_empty() {
            return None;
        }
        parts.remove(0);
    }
    if parts.iter().any(|part| *part == "..") {
        return None;
    }
    Some(parts.iter().fold(base.to_path_buf(), |path, part| path.join(part)))
}

fn extract(bytes: &[u8], dest: &Path, strip_first: bool) -> CmdResult<()> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|err| CommandError::new("PROVIDER_EXTRACT_FAILED", "The provider archive is not valid.").with_detail(err.to_string()))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| {
            CommandError::new("PROVIDER_EXTRACT_FAILED", "Could not read the provider archive.").with_detail(err.to_string())
        })?;
        let Some(path) = safe_path(dest, entry.name(), strip_first) else {
            continue;
        };
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&path);
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CommandError::new("PROVIDER_EXTRACT_FAILED", "Could not create provider files.").with_detail(err.to_string())
            })?;
        }
        let mut file = std::fs::File::create(&path).map_err(|err| {
            CommandError::new("PROVIDER_EXTRACT_FAILED", "Could not write provider files.").with_detail(err.to_string())
        })?;
        std::io::copy(&mut entry, &mut file).map_err(|err| {
            CommandError::new("PROVIDER_EXTRACT_FAILED", "Could not write provider files.").with_detail(err.to_string())
        })?;
    }
    Ok(())
}

/// Probe the provider port without blocking a runtime thread.
async fn port_open() -> bool {
    matches!(
        tokio::time::timeout(Duration::from_millis(700), TcpStream::connect(LOCAL_URL)).await,
        Ok(Ok(_))
    )
}

/// Provider status for Settings.
pub async fn status(settings: &Settings, pid: &std::sync::Mutex<Option<u32>>) -> ProviderStatus {
    let installed = settings
        .pot_server_dir
        .as_deref()
        .map(|dir| Path::new(dir).join("build").join("main.js").is_file())
        .unwrap_or(false);
    let running = port_open().await;
    if !running {
        let _ = lock(pid).take();
    }
    let message = if running {
        "Provider is running on 127.0.0.1:4416.".to_string()
    } else if installed {
        "Provider is installed but not running.".to_string()
    } else {
        "No provider installed. YouTube may require one for some videos.".to_string()
    };
    ProviderStatus {
        installed,
        running,
        enabled: settings.pot_provider_enabled,
        version: installed.then(|| PROVIDER_TAG.to_string()),
        message,
    }
}

/// Download and build the pinned PO Token provider.
pub async fn install(app: &tauri::AppHandle) -> CmdResult<ProviderInstall> {
    let http = client()?;
    let info = release(&http).await?;
    if info.tag_name.trim_start_matches('v') != PROVIDER_TAG {
        return Err(CommandError::new(
            "PROVIDER_VERSION_UNSUPPORTED",
            "This installer supports provider version 2.0.2. Install a newer release manually from the official page.",
        ));
    }

    let plugin_asset = info
        .assets
        .iter()
        .find(|asset| asset.name == "bgutil-ytdlp-pot-provider.zip")
        .ok_or_else(|| CommandError::new("PROVIDER_ASSET_MISSING", "The release has no plugin archive."))?;
    let expected_plugin = plugin_asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    if expected_plugin.len() != 64 {
        return Err(CommandError::new("CHECKSUM_UNAVAILABLE", "The release did not provide a plugin checksum."));
    }

    let node_version = process_manager::run_capture(Path::new("node"), &["--version".into()], Duration::from_secs(30)).await?;
    if !node_version.success {
        return Err(CommandError::new("NODE_MISSING", "Node.js 22 or newer is required. Install it from nodejs.org and try again."));
    }

    let plugin_bytes = http
        .get(&plugin_asset.browser_download_url)
        .send().await.map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "Could not download the provider plugin.").with_detail(err.to_string()))?
        .error_for_status().map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "The provider plugin download was rejected.").with_detail(err.to_string()))?
        .bytes().await.map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "The provider plugin download did not complete.").with_detail(err.to_string()))?;
    if sha256_hex(&plugin_bytes) != expected_plugin {
        return Err(CommandError::new("CHECKSUM_MISMATCH", "The provider plugin did not match its official checksum. Nothing was installed."));
    }

    let source_url = format!(
        "https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/zip/refs/tags/{PROVIDER_TAG}"
    );
    let source_bytes = http
        .get(&source_url)
        .send().await.map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "Could not download the provider server.").with_detail(err.to_string()))?
        .error_for_status().map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "The provider server download was rejected.").with_detail(err.to_string()))?
        .bytes().await.map_err(|err| CommandError::new("PROVIDER_DOWNLOAD_FAILED", "The provider server download did not complete.").with_detail(err.to_string()))?;
    if sha256_hex(&source_bytes) != SOURCE_SHA256 {
        return Err(CommandError::new("CHECKSUM_MISMATCH", "The provider server did not match its pinned checksum. Nothing was installed."));
    }

    let base = app
        .path()
        .app_config_dir()
        .map_err(|_| CommandError::new("PROVIDER_DIR_ERROR", "Could not find the app data folder."))?
        .join("bin")
        .join("pot-provider");
    let plugin_dir = base.join("plugins");
    let source_dir = base.join("source");
    let server_dir = source_dir.join("server");

    let _ = tokio::fs::remove_dir_all(&plugin_dir).await;
    let _ = tokio::fs::remove_dir_all(&source_dir).await;
    tokio::fs::create_dir_all(&plugin_dir).await.map_err(|err| CommandError::new("PROVIDER_DIR_ERROR", "Could not create the provider folder.").with_detail(err.to_string()))?;
    tokio::fs::create_dir_all(&source_dir).await.map_err(|err| CommandError::new("PROVIDER_DIR_ERROR", "Could not create the provider folder.").with_detail(err.to_string()))?;

    // `--plugin-dirs` expects a directory whose children are plugin packages,
    // so the archive goes into a package subfolder, not the directory root.
    extract(&plugin_bytes, &plugin_dir.join("bgutil-ytdlp-pot-provider"), false)?;
    extract(&source_bytes, &source_dir, true)?;

    let npm_check = process_manager::run_capture(Path::new("cmd"), &["/C".into(), "npm".into(), "--version".into()], Duration::from_secs(60)).await?;
    if !npm_check.success {
        return Err(CommandError::new("NPM_MISSING", "npm is required. Install Node.js 22 or newer and try again."));
    }

    for (args, label) in [
        (vec!["/C".to_string(), "npm".into(), "ci".into()], "npm ci"),
        (vec!["/C".to_string(), "npx".into(), "tsc".into()], "npx tsc"),
    ] {
        let output = process_manager::run_capture_in(
            Path::new("cmd"),
            &args,
            Duration::from_secs(600),
            Some(&server_dir),
        )
        .await?;
        if !output.success {
            return Err(CommandError::new(
                "PROVIDER_BUILD_FAILED",
                format!("The provider could not be prepared ({label}). Check the Node.js installation and try again."),
            )
            .with_detail(crate::services::yt_dlp::tail(&format!("{}\n{}", output.stdout, output.stderr), 8)));
        }
    }

    if !server_dir.join("build").join("main.js").is_file() {
        return Err(CommandError::new("PROVIDER_BUILD_FAILED", "The provider server was not built correctly."));
    }

    Ok(ProviderInstall {
        plugin_dir: plugin_dir.to_string_lossy().into_owned(),
        server_dir: server_dir.to_string_lossy().into_owned(),
        version: PROVIDER_TAG.to_string(),
        status: ProviderStatus {
            installed: true,
            running: false,
            enabled: true,
            version: Some(PROVIDER_TAG.to_string()),
            message: "Provider installed and verified. Starting it now.".to_string(),
        },
    })
}

/// Start the provider server in the background; keep only its PID.
pub async fn start(
    settings: &Settings,
    pid: &std::sync::Mutex<Option<u32>>,
) -> CmdResult<ProviderStatus> {
    if port_open().await {
        return Ok(status(settings, pid).await);
    }
    let Some(server_dir) = settings.pot_server_dir.as_deref() else {
        return Err(CommandError::new("PROVIDER_NOT_INSTALLED", "Install the provider first."));
    };
    let server_dir = PathBuf::from(server_dir);
    if !server_dir.join("build").join("main.js").is_file() {
        return Err(CommandError::new("PROVIDER_NOT_INSTALLED", "The provider server is missing. Install it again."));
    }

    let mut command = Command::new("node");
    command
        .arg("build/main.js")
        .current_dir(&server_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(false);
    process_manager::hide_console(&mut command);
    let child = command.spawn().map_err(|err| {
        CommandError::new("PROVIDER_START_FAILED", "Could not start the provider server. Check that Node.js is installed.").with_detail(err.to_string())
    })?;
    *lock(pid) = child.id();
    drop(child);

    for _ in 0..20 {
        if port_open().await {
            return Ok(status(settings, pid).await);
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    Err(CommandError::new(
        "PROVIDER_START_FAILED",
        "The provider did not become ready. Try starting it again.",
    ))
}

pub async fn start_if_installed(
    settings: &Settings,
    pid: &std::sync::Mutex<Option<u32>>,
) -> Option<ProviderStatus> {
    if !settings.pot_provider_enabled {
        return None;
    }
    if port_open().await {
        return Some(status(settings, pid).await);
    }
    let server_dir = settings.pot_server_dir.as_ref()?;
    if !Path::new(server_dir).join("build").join("main.js").is_file() {
        return None;
    }
    start(settings, pid).await.ok()
}

/// Kill the provider process, if this app started one. Never blocks.
pub fn kill(pid: &std::sync::Mutex<Option<u32>>) {
    if let Some(process_id) = lock(pid).take() {
        process_manager::kill_tree(process_id);
    }
}

pub async fn stop(settings: &Settings, pid: &std::sync::Mutex<Option<u32>>) -> ProviderStatus {
    kill(pid);
    status(settings, pid).await
}
