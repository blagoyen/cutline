use tauri::State;

use crate::error::CommandError;
use crate::models::download::{DownloadRequest, DownloadTask};
use crate::AppState;

#[tauri::command]
pub fn start_download(
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> Result<DownloadTask, CommandError> {
    let task = state.downloads.enqueue(&request)?;
    state.downloads.pump();
    Ok(task)
}

#[tauri::command]
pub fn start_batch(
    state: State<'_, AppState>,
    requests: Vec<DownloadRequest>,
) -> Result<Vec<DownloadTask>, CommandError> {
    if requests.is_empty() {
        return Err(CommandError::new(
            "NOTHING_SELECTED",
            "Add at least one cut before downloading.",
        ));
    }
    let mut tasks = Vec::with_capacity(requests.len());
    for request in &requests {
        tasks.push(state.downloads.enqueue(request)?);
    }
    state.downloads.pump();
    Ok(tasks)
}

#[tauri::command]
pub fn list_downloads(state: State<'_, AppState>) -> Vec<DownloadTask> {
    state.downloads.list()
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.downloads.cancel(&id)
}

#[tauri::command]
pub fn retry_download(
    state: State<'_, AppState>,
    id: String,
) -> Result<DownloadTask, CommandError> {
    let task = state.downloads.retry(&id)?;
    state.downloads.pump();
    Ok(task)
}

#[tauri::command]
pub fn remove_download(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.downloads.remove(&id)
}

#[tauri::command]
pub fn clear_finished_downloads(state: State<'_, AppState>) -> Vec<DownloadTask> {
    state.downloads.clear_finished()
}
