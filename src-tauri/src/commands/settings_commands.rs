use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::error::CommandError;
use crate::models::Settings;
use crate::services::auth::{self, AuthTestResult, BrowserProfileInfo};
use crate::services::binaries::{self, DependencyReport, Tool};
use crate::services::pot_provider::{self, ProviderInstall, ProviderStatus};
use crate::services::process_manager;
use crate::services::updater::{self, UpdateInfo, UpdateResult};
use crate::services::yt_dlp;
use crate::util::lock;
use crate::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, CommandError> {
    Ok(lock(&state.settings).clone())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, CommandError> {
    let mut next = settings.sanitized();

    if next.output_dir.trim().is_empty() {
        next.output_dir = state.default_output_dir.clone();
    }

    for (tool, value) in [
        (Tool::YtDlp, next.yt_dlp_path.as_deref()),
        (Tool::Ffmpeg, next.ffmpeg_path.as_deref()),
        (Tool::Ffprobe, next.ffprobe_path.as_deref()),
    ] {
        if let Some(path) = value {
            binaries::verify_binary(tool, path).await?;
        }
    }

    if let Some(dir) = next.pot_plugin_dir.as_deref() {
        if !Path::new(dir).is_dir() {
            return Err(CommandError::new(
                "PLUGIN_DIR_NOT_FOUND",
                "That PO Token provider folder does not exist. Install the plugin and choose its folder again, or clear the field.",
            ));
        }
    }

    tokio::fs::create_dir_all(&next.output_dir)
        .await
        .map_err(|err| {
            CommandError::new(
                "OUTPUT_DIR_ERROR",
                "That output folder could not be created. Choose another location.",
            )
            .with_detail(err.to_string())
        })?;

    if !Path::new(&next.output_dir).is_dir() {
        return Err(CommandError::new(
            "OUTPUT_DIR_ERROR",
            "That output folder is not accessible.",
        ));
    }

    {
        let mut current = lock(&state.settings);
        *current = next.clone();
    }
    state.save_settings()?;
    state.downloads.pump();
    Ok(next)
}

#[tauri::command]
pub async fn check_dependencies(
    state: State<'_, AppState>,
) -> Result<DependencyReport, CommandError> {
    let settings = lock(&state.settings).clone();
    Ok(binaries::check_dependencies(&settings).await)
}

#[tauri::command]
pub async fn install_dependencies(
    state: State<'_, AppState>,
) -> Result<DependencyReport, CommandError> {
    let settings = lock(&state.settings).clone();
    binaries::install_missing(&settings).await
}

/// Test YouTube auth using the supplied settings.
#[tauri::command]
pub async fn test_youtube_auth(
    state: State<'_, AppState>,
    settings: Settings,
    url: Option<String>,
) -> Result<AuthTestResult, CommandError> {
    let settings = settings.sanitized();
    let _ = pot_provider::start_if_installed(&settings, &state.pot_pid).await;
    auth::test_authentication(&settings, url).await
}

/// List browser profiles for the dropdown.
/// Async so the filesystem scan runs off the UI thread.
#[tauri::command]
pub async fn browser_profiles(browser: String) -> BrowserProfileInfo {
    auth::browser_profiles(&browser)
}

#[tauri::command]
pub async fn check_ytdlp_update(
    state: State<'_, AppState>,
) -> Result<UpdateInfo, CommandError> {
    let settings = lock(&state.settings).clone();
    updater::check(&settings).await
}

/// Install a yt-dlp update into the app data folder.
#[tauri::command]
pub async fn update_ytdlp(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateResult, CommandError> {
    let settings = lock(&state.settings).clone();
    let result = updater::install(&app, &settings).await?;
    {
        let mut current = lock(&state.settings);
        current.yt_dlp_path = Some(result.path.clone());
    }
    state.save_settings()?;
    Ok(result)
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle, default_path: Option<String>) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<PathBuf>>();

    let dialog = app
        .dialog()
        .file()
        .set_title("Choose a download folder");
    let dialog = match default_path {
        Some(path) if Path::new(&path).is_dir() => dialog.set_directory(PathBuf::from(path)),
        _ => dialog,
    };

    dialog.pick_folder(move |selection| {
        let resolved = selection.and_then(|file_path| file_path.into_path().ok());
        let _ = tx.send(resolved);
    });

    rx.await.ok().flatten().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn pick_binary(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<PathBuf>>();

    let dialog = app.dialog().file().set_title("Select executable");
    #[cfg(windows)]
    let dialog = dialog.add_filter("Executable", &["exe"]);

    dialog.pick_file(move |selection| {
        let resolved = selection.and_then(|file_path| file_path.into_path().ok());
        let _ = tx.send(resolved);
    });

    rx.await.ok().flatten().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), CommandError> {
    let parsed = url::Url::parse(&url)
        .map_err(|_| CommandError::new("INVALID_URL", "That link is not valid."))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::new(
            "INVALID_URL",
            "Only http and https links can be opened.",
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| CommandError::new("OPEN_FAILED", err.to_string()))
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), CommandError> {
    if !Path::new(&path).exists() {
        return Err(CommandError::new(
            "PATH_NOT_FOUND",
            "That file or folder no longer exists.",
        ));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| CommandError::new("OPEN_FAILED", err.to_string()))
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), CommandError> {
    if !Path::new(&path).exists() {
        return Err(CommandError::new(
            "PATH_NOT_FOUND",
            "That file or folder no longer exists.",
        ));
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|err| CommandError::new("OPEN_FAILED", err.to_string()))
}

#[tauri::command]
pub async fn open_output_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let dir = lock(&state.settings).output_dir.clone();
    tokio::fs::create_dir_all(&dir).await.map_err(|err| {
        CommandError::new("OUTPUT_DIR_ERROR", "The output folder could not be opened.")
            .with_detail(err.to_string())
    })?;
    app.opener()
        .open_path(dir, None::<&str>)
        .map_err(|err| CommandError::new("OPEN_FAILED", err.to_string()))
}

#[tauri::command]
pub async fn diagnose_youtube(
    state: State<'_, AppState>,
    settings: Settings,
    url: Option<String>,
) -> Result<String, CommandError> {
    let settings = settings.sanitized();
    let _ = pot_provider::start_if_installed(&settings, &state.pot_pid).await;

    let bin = binaries::resolve(Tool::YtDlp, &settings).ok_or_else(|| {
        CommandError::new("YTDLP_MISSING", "yt-dlp was not found. Set its path in Settings.")
    })?;

    let target = url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string());
    let (canonical, _) = yt_dlp::canonicalize(&target)?;

    let mut args: Vec<String> = vec![
        "-v".into(),
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--list-formats".into(),
        "--extractor-retries".into(),
        "0".into(),
        "--socket-timeout".into(),
        "20".into(),
    ];
    yt_dlp::auth_args(&settings, &mut args);
    args.push("--".into());
    args.push(canonical);

    let output = process_manager::run_capture(&bin, &args, std::time::Duration::from_secs(180)).await?;
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let mut lines: Vec<&str> = combined.lines().rev().take(120).collect();
    lines.reverse();
    Ok(lines.join("\n"))
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Install and start the optional PO Token provider.
#[tauri::command]
pub async fn install_pot_provider(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProviderInstall, CommandError> {
    let installed = pot_provider::install(&app).await?;
    {
        let mut current = lock(&state.settings);
        current.pot_plugin_dir = Some(installed.plugin_dir.clone());
        current.pot_server_dir = Some(installed.server_dir.clone());
        current.pot_provider_enabled = true;
    }
    state.save_settings()?;

    let settings = lock(&state.settings).clone();
    let status = match pot_provider::start(&settings, &state.pot_pid).await {
        Ok(status) => status,
        Err(err) => {
            let mut fallback = pot_provider::status(&settings, &state.pot_pid).await;
            fallback.message = format!("{} {}", fallback.message, err.message);
            fallback
        }
    };
    Ok(ProviderInstall {
        status,
        ..installed
    })
}

#[tauri::command]
pub async fn start_pot_provider(
    state: State<'_, AppState>,
) -> Result<ProviderStatus, CommandError> {
    let settings = lock(&state.settings).clone();
    pot_provider::start(&settings, &state.pot_pid).await
}

// Async: the port probe can take up to 700 ms and must not freeze the UI thread.
#[tauri::command]
pub async fn stop_pot_provider(state: State<'_, AppState>) -> Result<ProviderStatus, CommandError> {
    let settings = lock(&state.settings).clone();
    Ok(pot_provider::stop(&settings, &state.pot_pid).await)
}

#[tauri::command]
pub async fn pot_provider_status(
    state: State<'_, AppState>,
) -> Result<ProviderStatus, CommandError> {
    let settings = lock(&state.settings).clone();
    Ok(pot_provider::status(&settings, &state.pot_pid).await)
}

