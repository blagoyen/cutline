use serde::{Deserialize, Serialize};

pub const QUALITIES: [&str; 8] = [
    "best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst",
];

pub fn normalize_quality(value: &str) -> String {
    let candidate = value.trim().to_lowercase();
    if QUALITIES.contains(&candidate.as_str()) {
        candidate
    } else {
        "best".to_string()
    }
}

pub fn normalize_format(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "mp3" => "mp3".to_string(),
        _ => "mp4".to_string(),
    }
}

/// Browsers supported by yt-dlp's `--cookies-from-browser`.
pub const AUTH_BROWSERS: [&str; 6] = ["chrome", "edge", "firefox", "brave", "chromium", "none"];

pub fn normalize_auth_browser(value: &str) -> String {
    let candidate = value.trim().to_lowercase();
    if AUTH_BROWSERS.contains(&candidate.as_str()) {
        candidate
    } else {
        "none".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub output_dir: String,
    pub default_quality: String,
    pub default_format: String,
    pub precise_cutting: bool,
    /// Filename pattern for batch exports, e.g. `{Title} - Clip {NN}`.
    pub naming_template: String,
    /// When true, a batch export produces one concatenated file.
    pub merge_cuts: bool,
    pub max_concurrent_downloads: u8,
    pub yt_dlp_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    /// Optional directory containing a yt-dlp PO Token provider plugin.
    pub pot_plugin_dir: Option<String>,
    pub pot_server_dir: Option<String>,
    pub pot_provider_enabled: bool,
    /// Browser authentication is opt-in; cookies are never read unless enabled.
    pub auth_enabled: bool,
    pub auth_browser: String,
    /// yt-dlp profile value, e.g. "Profile 1" (Chromium) or a Firefox profile name.
    pub auth_profile: Option<String>,
    pub theme: String,
    /// Short, locally synthesised interface sounds. On by default.
    pub sound_effects: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            output_dir: String::new(),
            default_quality: "best".to_string(),
            default_format: "mp4".to_string(),
            precise_cutting: false,
            naming_template: "{Title} - Clip {NN}".to_string(),
            merge_cuts: false,
            max_concurrent_downloads: 2,
            yt_dlp_path: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            pot_plugin_dir: None,
            pot_server_dir: None,
            pot_provider_enabled: false,
            auth_enabled: false,
            auth_browser: "chrome".to_string(),
            auth_profile: None,
            theme: "light".to_string(),
            sound_effects: true,
        }
    }
}

impl Settings {
    /// Coerce arbitrary input (frontend / edited JSON file) into a valid state.
    pub fn sanitized(mut self) -> Self {
        self.default_quality = normalize_quality(&self.default_quality);
        self.default_format = normalize_format(&self.default_format);
        self.naming_template = self.naming_template.trim().to_string();
        if self.naming_template.is_empty() {
            self.naming_template = "{Title} - Clip {NN}".to_string();
        }
        self.max_concurrent_downloads = self.max_concurrent_downloads.clamp(1, 4);
        self.theme = match self.theme.trim().to_lowercase().as_str() {
            "dark" => "dark".to_string(),
            _ => "light".to_string(),
        };
        self.yt_dlp_path = clean_optional(self.yt_dlp_path);
        self.ffmpeg_path = clean_optional(self.ffmpeg_path);
        self.ffprobe_path = clean_optional(self.ffprobe_path);
        self.pot_plugin_dir = clean_optional(self.pot_plugin_dir);
        self.pot_server_dir = clean_optional(self.pot_server_dir);
        self.auth_browser = normalize_auth_browser(&self.auth_browser);
        self.auth_profile = clean_optional(self.auth_profile);
        self
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}
