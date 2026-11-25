mod commands;
mod error;
mod models;
mod services;
mod util;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::Manager;

use error::CommandError;
use models::Settings;
use services::download_manager::DownloadManager;
use util::lock;

pub struct AppState {
    pub settings: Arc<Mutex<Settings>>,
    pub settings_path: PathBuf,
    pub default_output_dir: String,
    pub downloads: Arc<DownloadManager>,
    /// PID of the optional local PO Token provider server.
    pub pot_pid: Arc<Mutex<Option<u32>>>,
}

impl AppState {
    pub fn save_settings(&self) -> Result<(), CommandError> {
        let value = lock(&self.settings).clone();
        let json = serde_json::to_string_pretty(&value)?;
        if let Some(parent) = self.settings_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.settings_path, json).map_err(|err| {
            CommandError::new("SETTINGS_WRITE_FAILED", "Settings could not be saved.")
                .with_detail(err.to_string())
        })?;
        Ok(())
    }
}

fn load_settings(path: &Path, fallback_output_dir: &str) -> Settings {
    let mut settings = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
        .sanitized();

    if settings.output_dir.trim().is_empty() {
        settings.output_dir = fallback_output_dir.to_string();
    }
    settings
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&config_dir);
            let settings_path = config_dir.join("settings.json");

            let default_output_dir = app
                .path()
                .video_dir()
                .map(|dir| dir.join("Cutline"))
                .or_else(|_| app.path().home_dir().map(|dir| dir.join("Videos").join("Cutline")))
                .unwrap_or_else(|_| PathBuf::from("Cutline"))
                .to_string_lossy()
                .into_owned();
            let _ = std::fs::create_dir_all(&default_output_dir);

            let settings = load_settings(&settings_path, &default_output_dir);
            let _ = std::fs::create_dir_all(&settings.output_dir);

            let settings = Arc::new(Mutex::new(settings));
            let downloads = DownloadManager::new(app.handle().clone(), Arc::clone(&settings));
            let pot_pid = Arc::new(Mutex::new(None));

            let pot_settings = lock(&settings).clone();
            app.manage(AppState {
                settings,
                settings_path,
                default_output_dir,
                downloads,
                pot_pid: Arc::clone(&pot_pid),
            });

            if pot_settings.pot_provider_enabled {
                let pid = Arc::clone(&pot_pid);
                tauri::async_runtime::spawn(async move {
                    let _ = services::pot_provider::start(&pot_settings, &pid).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::video_commands::probe_video,
            commands::video_commands::validate_url,
            commands::download_commands::start_download,
            commands::download_commands::start_batch,
            commands::download_commands::list_downloads,
            commands::download_commands::cancel_download,
            commands::download_commands::retry_download,
            commands::download_commands::remove_download,
            commands::download_commands::clear_finished_downloads,
            commands::settings_commands::get_settings,
            commands::settings_commands::update_settings,
            commands::settings_commands::check_dependencies,
            commands::settings_commands::test_youtube_auth,
            commands::settings_commands::browser_profiles,
            commands::settings_commands::check_ytdlp_update,
            commands::settings_commands::update_ytdlp,
            commands::settings_commands::install_pot_provider,
            commands::settings_commands::start_pot_provider,
            commands::settings_commands::stop_pot_provider,
            commands::settings_commands::pot_provider_status,
            commands::settings_commands::diagnose_youtube,
            commands::settings_commands::pick_directory,
            commands::settings_commands::pick_binary,
            commands::settings_commands::open_url,
            commands::settings_commands::open_path,
            commands::settings_commands::reveal_path,
            commands::settings_commands::open_output_folder,
            commands::settings_commands::app_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building YT Cutter")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.downloads.shutdown();
                    services::pot_provider::kill(&state.pot_pid);
                }
            }
        });
}
