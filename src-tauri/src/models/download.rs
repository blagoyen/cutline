use serde::{Deserialize, Serialize};

use crate::util::now_ms;

use super::settings::{normalize_format, normalize_quality};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Fetching,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    pub fn is_active(self) -> bool {
        matches!(self, DownloadStatus::Fetching | DownloadStatus::Processing)
    }
}

/// One time range in a download. Multiple sections are downloaded separately and joined afterward.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSection {
    pub start_ms: u64,
    pub end_ms: u64,
}

/// What the frontend asks the backend to download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub clip_id: String,
    pub clip_name: String,
    /// Human readable base for the output file, e.g. "Video Title - Clip 01".
    pub file_base: String,
    pub url: String,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(default)]
    pub sections: Vec<DownloadSection>,
    pub quality: String,
    pub format: String,
    pub precise: bool,
}

impl DownloadRequest {
    /// Older callers send only start/end; treat that as one section.
    pub fn effective_sections(&self) -> Vec<DownloadSection> {
        if self.sections.is_empty() {
            vec![DownloadSection {
                start_ms: self.start_ms,
                end_ms: self.end_ms,
            }]
        } else {
            self.sections.clone()
        }
    }
}

/// The live state of one download, mirrored to the UI through events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub clip_id: String,
    pub clip_name: String,
    pub file_base: String,
    pub url: String,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(default)]
    pub sections: Vec<DownloadSection>,
    pub quality: String,
    pub format: String,
    pub precise: bool,
    pub status: DownloadStatus,
    pub progress: f32,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bps: Option<f64>,
    pub eta_secs: Option<u64>,
    pub output_path: Option<String>,
    pub file_size: Option<u64>,
    pub duration_ms: Option<u64>,
    pub has_audio: bool,
    pub has_video: bool,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub attempt: u32,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

impl DownloadTask {
    pub fn effective_sections(&self) -> Vec<DownloadSection> {
        if self.sections.is_empty() {
            vec![DownloadSection {
                start_ms: self.start_ms,
                end_ms: self.end_ms,
            }]
        } else {
            self.sections.clone()
        }
    }

    pub fn queued(request: &DownloadRequest) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            clip_id: request.clip_id.clone(),
            clip_name: request.clip_name.clone(),
            file_base: request.file_base.clone(),
            url: request.url.clone(),
            start_ms: request.start_ms,
            end_ms: request.end_ms,
            sections: request.effective_sections(),
            quality: normalize_quality(&request.quality),
            format: normalize_format(&request.format),
            precise: request.precise,
            status: DownloadStatus::Queued,
            progress: 0.0,
            downloaded_bytes: None,
            total_bytes: None,
            speed_bps: None,
            eta_secs: None,
            output_path: None,
            file_size: None,
            duration_ms: None,
            has_audio: false,
            has_video: false,
            error: None,
            error_code: None,
            error_detail: None,
            attempt: 0,
            created_at: now_ms(),
            started_at: None,
            finished_at: None,
        }
    }

    pub fn reset_for_retry(&mut self) {
        self.status = DownloadStatus::Queued;
        self.progress = 0.0;
        self.downloaded_bytes = None;
        self.total_bytes = None;
        self.speed_bps = None;
        self.eta_secs = None;
        self.error = None;
        self.error_code = None;
        self.error_detail = None;
        self.finished_at = None;
        self.started_at = None;
    }
}
