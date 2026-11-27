use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoSource {
    Youtube,
    Twitch,
    Tiktok,
}

impl Default for VideoSource {
    fn default() -> Self {
        VideoSource::Youtube
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub height: Option<u32>,
    pub width: Option<u32>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub note: Option<String>,
}

/// Video chapter metadata, used for jumps and chapter cuts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub start_ms: u64,
    pub end_ms: u64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: String,
    #[serde(default)]
    pub source: VideoSource,
    pub title: String,
    pub duration_ms: u64,
    pub thumbnail: String,
    pub uploader: Option<String>,
    pub webpage_url: String,
    #[serde(default)]
    pub stream_url: Option<String>,
    #[serde(default)]
    pub audio_stream_url: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
    pub is_live: bool,
    pub max_height: u32,
    pub heights: Vec<u32>,
    pub formats: Vec<FormatInfo>,
    pub upload_date: Option<String>,
    pub view_count: Option<u64>,
    pub chapters: Vec<Chapter>,
}
