use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

use crate::error::{CmdResult, CommandError};
use crate::models::Settings;
use crate::services::process_manager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    YtDlp,
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    pub fn exe_name(self) -> &'static str {
        match self {
            Tool::YtDlp => "yt-dlp",
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Tool::YtDlp => "yt-dlp",
            Tool::Ffmpeg => "FFmpeg",
            Tool::Ffprobe => "FFprobe",
        }
    }

    fn override_path<'a>(self, settings: &'a Settings) -> Option<&'a str> {
        match self {
            Tool::YtDlp => settings.yt_dlp_path.as_deref(),
            Tool::Ffmpeg => settings.ffmpeg_path.as_deref(),
            Tool::Ffprobe => settings.ffprobe_path.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub name: String,
    pub found: bool,
    pub ready: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyReport {
    pub yt_dlp: DependencyInfo,
    pub ffmpeg: DependencyInfo,
    pub ffprobe: DependencyInfo,
    pub ready: bool,
}

fn file_name_for(tool: Tool) -> String {
    if cfg!(windows) {
        format!("{}.exe", tool.exe_name())
    } else {
        tool.exe_name().to_string()
    }
}

fn extra_search_dirs() -> &'static [PathBuf] {
    static DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    DIRS.get_or_init(|| {
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
            dirs.push(local.join("Programs").join("ffmpeg").join("bin"));
            dirs.push(local.join("Programs").join("yt-dlp"));
            dirs.push(local.join("ffmpeg").join("bin"));
            dirs.push(local.join("YT Cutter").join("bin"));
        }
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let home = PathBuf::from(home);
            dirs.push(home.join("scoop").join("shims"));
            dirs.push(home.join(".local").join("bin"));
        }
        dirs.push(PathBuf::from("C:\\ffmpeg\\bin"));
        dirs.push(PathBuf::from("C:\\ProgramData\\chocolatey\\bin"));
        dirs.push(PathBuf::from("C:\\Program Files\\ffmpeg\\bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                dirs.push(dir.to_path_buf());
                dirs.push(dir.join("bin"));
                dirs.push(dir.join("resources"));
                dirs.push(dir.join("resources").join("bin"));
                if let Some(parent) = dir.parent() {
                    dirs.push(parent.join("resources"));
                }
            }
        }
        dirs
    })
}

/// Locate a tool, preferring an explicit user configuration.
pub fn resolve(tool: Tool, settings: &Settings) -> Option<PathBuf> {
    if let Some(configured) = tool.override_path(settings) {
        let candidate = PathBuf::from(configured);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // If FFmpeg was configured explicitly, look for its sibling FFprobe first.
    if tool == Tool::Ffprobe {
        if let Some(ffmpeg) = settings.ffmpeg_path.as_deref() {
            if let Some(dir) = Path::new(ffmpeg).parent() {
                let sibling = dir.join(file_name_for(Tool::Ffprobe));
                if sibling.is_file() {
                    return Some(sibling);
                }
            }
        }
    }

    let name = file_name_for(tool);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.extend(extra_search_dirs().iter().cloned());

    for dir in &dirs {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(&name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // Common nested layout: <root>/ffmpeg/bin/ffmpeg.exe
    if tool != Tool::YtDlp {
        for dir in &dirs {
            let nested = dir.join("ffmpeg").join("bin").join(&name);
            if nested.is_file() {
                return Some(nested);
            }
        }
    }
    None
}

fn source_for(tool: Tool, path: &Path, settings: &Settings) -> String {
    if let Some(configured) = tool.override_path(settings) {
        if Path::new(configured) == path {
            return "custom".to_string();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if path.starts_with(dir) {
                return "bundled".to_string();
            }
        }
    }
    "system".to_string()
}

pub async fn tool_version(tool: Tool, path: &Path) -> (Option<String>, Option<String>) {
    let args: Vec<String> = match tool {
        Tool::YtDlp => vec!["--version".to_string()],
        _ => vec!["-version".to_string()],
    };
    match process_manager::run_capture(path, &args, Duration::from_secs(10)).await {
        Ok(output) if output.success => {
            let line = output
                .stdout
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .to_string();
            let version = match tool {
                Tool::YtDlp => line,
                _ => line
                    .split_whitespace()
                    .nth(2)
                    .unwrap_or(&line)
                    .trim_matches(',')
                    .to_string(),
            };
            (
                if version.is_empty() { None } else { Some(version) },
                None,
            )
        }
        Ok(output) => {
            let detail = if output.stderr.trim().is_empty() {
                output.stdout
            } else {
                output.stderr
            };
            (None, Some(first_lines(&detail, 3)))
        }
        Err(err) => (None, Some(err.message)),
    }
}

fn first_lines(text: &str, count: usize) -> String {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .take(count)
        .collect::<Vec<_>>()
        .join("\n")
}

async fn check(tool: Tool, settings: &Settings) -> DependencyInfo {
    let resolved = resolve(tool, settings);
    let Some(path) = resolved else {
        return DependencyInfo {
            name: tool.label().to_string(),
            found: false,
            ready: false,
            path: None,
            version: None,
            source: "missing".to_string(),
            error: None,
        };
    };

    let (version, error) = tool_version(tool, &path).await;
    DependencyInfo {
        name: tool.label().to_string(),
        found: true,
        ready: error.is_none() && version.is_some(),
        path: Some(path.to_string_lossy().into_owned()),
        version,
        source: source_for(tool, &path, settings),
        error,
    }
}

/// Check all three tools and return their versions.
pub async fn check_dependencies(settings: &Settings) -> DependencyReport {
    let (yt_dlp, ffmpeg, ffprobe) = tokio::join!(
        check(Tool::YtDlp, settings),
        check(Tool::Ffmpeg, settings),
        check(Tool::Ffprobe, settings)
    );
    let ready = yt_dlp.ready && ffmpeg.ready && ffprobe.ready;
    DependencyReport {
        yt_dlp,
        ffmpeg,
        ffprobe,
        ready,
    }
}

/// Confirm a user supplied executable path actually runs.
pub async fn verify_binary(tool: Tool, path: &str) -> CmdResult<DependencyInfo> {
    let candidate = PathBuf::from(path);
    if !candidate.is_file() {
        return Err(CommandError::new(
            "BINARY_NOT_FOUND",
            format!("{} was not found at that location.", tool.label()),
        ));
    }
    let (version, error) = tool_version(tool, &candidate).await;
    if error.is_some() {
        return Err(CommandError::new(
            "BINARY_NOT_EXECUTABLE",
            format!(
                "{} could not be executed. Check that the file is a valid {} build.",
                tool.label(),
                tool.label()
            ),
        )
        .with_detail(error.unwrap_or_default()));
    }
    Ok(DependencyInfo {
        name: tool.label().to_string(),
        found: true,
        ready: true,
        path: Some(path.to_string()),
        version,
        source: "custom".to_string(),
        error: None,
    })
}
