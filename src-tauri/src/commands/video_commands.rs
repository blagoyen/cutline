use tauri::State;

use crate::error::CommandError;
use crate::models::video::VideoInfo;
use crate::services::yt_dlp;
use crate::util::lock;
use crate::AppState;

/// Validate + resolve a YouTube link and pull real metadata through yt-dlp.
#[tauri::command]
pub async fn probe_video(
    state: State<'_, AppState>,
    url: String,
) -> Result<VideoInfo, CommandError> {
    let (canonical, _id) = yt_dlp::canonicalize(&url)?;
    let settings = lock(&state.settings).clone();
    let info = yt_dlp::fetch_metadata(&canonical, &settings).await?;

    if info.is_live {
        return Err(CommandError::new(
            "LIVE_NOT_SUPPORTED",
            "Live streams cannot be clipped. Try again once the broadcast has ended.",
        ));
    }
    if info.duration_ms == 0 {
        return Err(CommandError::new(
            "NO_DURATION",
            "This video does not expose a duration, so sections cannot be cut.",
        ));
    }

    Ok(info)
}

/// Lightweight client-side validation helper.
#[tauri::command]
pub fn validate_url(url: String) -> Result<String, CommandError> {
    yt_dlp::canonicalize(&url).map(|(canonical, _)| canonical)
}
