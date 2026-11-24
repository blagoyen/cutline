use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Notify};

use crate::error::CommandError;
use crate::models::download::{DownloadRequest, DownloadSection, DownloadStatus, DownloadTask};
use crate::models::Settings;
use crate::services::binaries::{self, Tool};
use crate::services::{ffmpeg, process_manager, yt_dlp};
use crate::util::{lock, now_ms, sanitize_filename, section_timestamp, unique_path};

/// Machine readable progress line forced through `--progress-template`.
const PROGRESS_TEMPLATE: &str = "download:YTCUT_PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";
const PROGRESS_PREFIX: &str = "YTCUT_PROGRESS|";

pub struct DownloadManager {
    app: AppHandle,
    settings: Arc<Mutex<Settings>>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    tasks: Vec<DownloadTask>,
    controls: HashMap<String, TaskControl>,
}

#[derive(Clone)]
struct TaskControl {
    cancel: Arc<Notify>,
    cancelled: Arc<AtomicBool>,
    pid: Arc<Mutex<Option<u32>>>,
}

impl TaskControl {
    fn new() -> Self {
        Self {
            cancel: Arc::new(Notify::new()),
            cancelled: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(Mutex::new(None)),
        }
    }
}

struct Outcome {
    path: PathBuf,
    size: u64,
    duration_ms: Option<u64>,
    has_audio: bool,
    has_video: bool,
}

struct ChildLine {
    text: String,
    from_stdout: bool,
}

struct Progress {
    downloaded: Option<u64>,
    total: Option<u64>,
    estimate: Option<u64>,
    speed: Option<f64>,
    eta: Option<u64>,
}

impl Progress {
    fn empty() -> Self {
        Self {
            downloaded: None,
            total: None,
            estimate: None,
            speed: None,
            eta: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_progress_lines() {
        let line = "YTCUT_PROGRESS|downloading|5242880|12582912|NA|3456789.12|2";
        let parsed = parse_progress(line).unwrap();
        assert_eq!(parsed.downloaded, Some(5_242_880));
        assert_eq!(parsed.total, Some(12_582_912));
        assert_eq!(parsed.speed, Some(3_456_789.12));
        assert_eq!(parsed.eta, Some(2));
        assert_eq!(parsed.estimate, None);

        let finished = "YTCUT_PROGRESS|finished|5658392|5658392|NA|1181308.81|NA";
        let parsed = parse_progress(finished).unwrap();
        assert_eq!(parsed.downloaded, Some(5_658_392));
        assert_eq!(parsed.eta, None);
    }

    #[test]
    fn ignores_unrelated_and_malformed_lines() {
        assert!(parse_progress("[download] 42% of 10MiB").is_none());
        assert!(parse_progress("YTCUT_PROGRESS|downloading|NA|NA|NA|NA|NA").is_some());
        assert!(parse_progress("YTCUT_PROGRESS|only|two").is_none());
    }
}

fn number(raw: &str) -> Option<f64> {
    if raw == "NA" || raw.is_empty() {
        return None;
    }
    raw.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)
}

fn parse_progress(line: &str) -> Option<Progress> {
    let rest = line.strip_prefix(PROGRESS_PREFIX)?;
    let parts: Vec<&str> = rest.split('|').collect();
    if parts.len() < 6 {
        return None;
    }
    Some(Progress {
        downloaded: number(parts[1]).map(|v| v as u64),
        total: number(parts[2]).map(|v| v as u64),
        estimate: number(parts[3]).map(|v| v as u64),
        speed: number(parts[4]),
        eta: number(parts[5]).map(|v| v as u64),
    })
}

fn stage_marker(line: &str) -> bool {
    line.contains("[Merger]")
        || line.contains("[ExtractAudio]")
        || line.contains("[VideoRemuxer]")
        || line.contains("[VideoConvertor]")
        || line.contains("[FixupM4a]")
        || line.contains("[Metadata]")
        || line.contains("[EmbedThumbnail]")
}

/// Build yt-dlp args for one section. Sections are downloaded separately and joined with ffmpeg.
fn build_args(
    task: &DownloadTask,
    section: &DownloadSection,
    tmp_dir: &Path,
    ffmpeg_dir: Option<&Path>,
    settings: &Settings,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-mtime".into(),
        "--newline".into(),
        "--progress".into(),
        "--concurrent-fragments".into(),
        "4".into(),
        "--retries".into(),
        "10".into(),
        "--fragment-retries".into(),
        "10".into(),
        "--extractor-retries".into(),
        // Avoid retry loops on auth errors.
        if settings.auth_enabled { "0".into() } else { "3".into() },
        "--socket-timeout".into(),
        "20".into(),
        "--download-sections".into(),
        format!(
            "*{}-{}",
            section_timestamp(section.start_ms),
            section_timestamp(section.end_ms)
        ),
    ];

    args.extend([
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
        "-o".into(),
        tmp_dir
            .join("clip.%(ext)s")
            .to_string_lossy()
            .into_owned(),
    ]);

    if let Some(dir) = ffmpeg_dir {
        args.push("--ffmpeg-location".into());
        args.push(dir.to_string_lossy().into_owned());
    }

    // Add YouTube-specific yt-dlp args.
    yt_dlp::auth_args(settings, &mut args);

    if task.format == "mp3" {
        args.extend([
            "-f".into(),
            "ba/b".into(),
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            "0".into(),
        ]);
    } else {
        args.push("-f".into());
        args.push(yt_dlp::format_selector(&task.quality));
        args.push("--merge-output-format".into());
        args.push("mp4".into());
        if task.precise {
            args.push("--force-keyframes-at-cuts".into());
        }
    }

    args.push("--".into());
    args.push(task.url.clone());
    args
}

/// Join sections with ffmpeg's concat demuxer (stream copy).
async fn concat_sections(
    ffmpeg_bin: &Path,
    parts: &[PathBuf],
    destination: &Path,
) -> Result<(), CommandError> {
    if parts.len() < 2 {
        return Ok(());
    }

    let list_path = destination.with_extension("concat.txt");
    let mut list = String::new();
    for part in parts {
        // ffmpeg's concat demuxer expects single-quoted paths with internal quotes escaped.
        let escaped = part
            .to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''");
        list.push_str(&format!("file '{}'\n", escaped));
    }
    tokio::fs::write(&list_path, list)
        .await
        .map_err(|err| CommandError::new("CONCAT_LIST_ERROR", err.to_string()))?;

    let args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_path.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        "-movflags".into(),
        "+faststart".into(),
        destination.to_string_lossy().into_owned(),
    ];

    let output = process_manager::run_capture(ffmpeg_bin, &args, Duration::from_secs(180))
        .await
        .map_err(|err| {
            CommandError::new("CONCAT_FAILED", "Could not merge the cuts into one file.")
                .with_detail(err.to_string())
        })?;
    let _ = tokio::fs::remove_file(&list_path).await;

    if !output.success {
        return Err(
            CommandError::new(
                "CONCAT_FAILED",
                "Could not merge the cuts into one file. The selected ranges may have incompatible streams.",
            )
            .with_detail(output.stderr),
        );
    }
    Ok(())
}

async fn read_lines<R>(reader: R, tx: mpsc::Sender<ChildLine>, from_stdout: bool)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(text)) = lines.next_line().await {
        if tx
            .send(ChildLine {
                text,
                from_stdout,
            })
            .await
            .is_err()
        {
            break;
        }
    }
}

async fn find_output(dir: &Path, format: &str) -> Option<PathBuf> {
    let preferred = if format == "mp3" { "mp3" } else { "mp4" };
    let mut best: Option<(u64, PathBuf)> = None;
    let mut fallback: Option<(u64, PathBuf)> = None;

    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
            continue;
        };
        if file_name.contains(".part") || file_name.ends_with(".ytdl") {
            continue;
        }
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
        if ext == preferred {
            if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
                best = Some((size, path));
            }
        } else if matches!(ext.as_str(), "mp4" | "mp3" | "mkv" | "webm" | "m4a") {
            if fallback.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
                fallback = Some((size, path));
            }
        }
    }

    Some(best.or(fallback)?.1)
}

async fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if tokio::fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    tokio::fs::copy(from, to).await?;
    let _ = tokio::fs::remove_file(from).await;
    Ok(())
}

impl DownloadManager {
    pub fn new(app: AppHandle, settings: Arc<Mutex<Settings>>) -> Arc<Self> {
        Arc::new(Self {
            app,
            settings,
            inner: Mutex::new(Inner::default()),
        })
    }

    pub fn list(&self) -> Vec<DownloadTask> {
        lock(&self.inner).tasks.clone()
    }

    pub fn enqueue(&self, request: &DownloadRequest) -> Result<DownloadTask, CommandError> {
        let (canonical_url, _) = yt_dlp::canonicalize(&request.url)?;
        let sections = request.effective_sections();
        for section in &sections {
            if section.end_ms <= section.start_ms {
                return Err(CommandError::new(
                    "INVALID_RANGE",
                    "Each cut's end time must be after its start time.",
                ));
            }
            if section.end_ms - section.start_ms < 100 {
                return Err(CommandError::new(
                    "RANGE_TOO_SHORT",
                    "Select at least 0.1 seconds for each cut.",
                ));
            }
        }

        let mut normalised = request.clone();
        normalised.sections = sections;
        normalised.url = canonical_url;
        let task = DownloadTask::queued(&normalised);
        {
            let mut inner = lock(&self.inner);
            if inner.tasks.len() >= 200 {
                inner
                    .tasks
                    .retain(|t| !matches!(t.status, DownloadStatus::Completed | DownloadStatus::Failed | DownloadStatus::Cancelled));
            }
            inner.tasks.push(task.clone());
        }
        self.emit_task(&task.id);
        Ok(task)
    }

    /// Start queued downloads up to the concurrency limit.
    pub fn pump(self: &Arc<Self>) {
        loop {
            let max = lock(&self.settings).max_concurrent_downloads.max(1) as usize;

            let next_id = {
                let mut inner = lock(&self.inner);
                let running = inner
                    .tasks
                    .iter()
                    .filter(|t| t.status.is_active())
                    .count();
                if running >= max {
                    break;
                }
                let Some(task) = inner
                    .tasks
                    .iter_mut()
                    .find(|t| t.status == DownloadStatus::Queued)
                else {
                    break;
                };
                task.status = DownloadStatus::Fetching;
                task.started_at = Some(now_ms());
                task.attempt += 1;
                task.error = None;
                task.error_code = None;
                task.error_detail = None;
                Some(task.id.clone())
            };

            let Some(id) = next_id else { break };
            lock(&self.inner).controls.insert(id.clone(), TaskControl::new());
            self.emit_task(&id);

            let this = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                this.run(id).await;
            });
        }
    }

    async fn run(self: Arc<Self>, id: String) {
        let (task, control) = {
            let inner = lock(&self.inner);
            (
                inner.tasks.iter().find(|t| t.id == id).cloned(),
                inner.controls.get(&id).cloned(),
            )
        };
        let (Some(task), Some(control)) = (task, control) else {
            return;
        };

        let result = self.execute(&task, &control).await;
        let was_cancelled = control.cancelled.load(Ordering::SeqCst);

        {
            let mut inner = lock(&self.inner);
            if let Some(entry) = inner.tasks.iter_mut().find(|t| t.id == id) {
                match result {
                    Ok(outcome) => {
                        entry.status = DownloadStatus::Completed;
                        entry.progress = 1.0;
                        entry.output_path = Some(outcome.path.to_string_lossy().into_owned());
                        entry.file_size = Some(outcome.size);
                        entry.duration_ms = outcome.duration_ms;
                        entry.has_audio = outcome.has_audio;
                        entry.has_video = outcome.has_video;
                        entry.speed_bps = None;
                        entry.eta_secs = None;
                        entry.error = None;
                        entry.error_code = None;
                        entry.error_detail = None;
                    }
                    Err(err) => {
                        if was_cancelled {
                            entry.status = DownloadStatus::Cancelled;
                        } else {
                            entry.status = DownloadStatus::Failed;
                            entry.error = Some(err.message.clone());
                            entry.error_code = Some(err.code.clone());
                            entry.error_detail = err.detail.clone();
                        }
                        entry.speed_bps = None;
                        entry.eta_secs = None;
                    }
                }
                entry.finished_at = Some(now_ms());
            }
            inner.controls.remove(&id);
        }

        self.emit_task(&id);
        self.pump();
    }

/// Download one section and return the output file.
    #[allow(clippy::too_many_arguments)]
    async fn run_section(
        &self,
        task: &DownloadTask,
        control: &TaskControl,
        settings: &Settings,
        section: &DownloadSection,
        section_index: usize,
        total_sections: usize,
        section_dir: &Path,
        tmp_root: &Path,
        tmp_dir: &Path,
        yt_dlp_bin: &Path,
        ffmpeg_dir: Option<&Path>,
    ) -> Result<PathBuf, CommandError> {
        let args = build_args(task, section, section_dir, ffmpeg_dir, settings);

        let mut command = Command::new(yt_dlp_bin);
        command
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        process_manager::hide_console(&mut command);

        let mut child = command.spawn().map_err(|err| {
            CommandError::new("PROCESS_SPAWN_FAILED", "Could not start yt-dlp.")
                .with_detail(err.to_string())
        })?;

        *lock(&control.pid) = child.id();

        let (tx, mut rx) = mpsc::channel::<ChildLine>(256);
        if let Some(stdout) = child.stdout.take() {
            tauri::async_runtime::spawn(read_lines(stdout, tx.clone(), true));
        }
        if let Some(stderr) = child.stderr.take() {
            tauri::async_runtime::spawn(read_lines(stderr, tx.clone(), false));
        }
        drop(tx);

        let mut progress: Option<Progress> = None;
        let mut stage = DownloadStatus::Fetching;
        let mut stderr_tail: VecDeque<String> = VecDeque::new();
        let mut cancelled = false;
        let mut ticker = tokio::time::interval(Duration::from_millis(300));
        let mut last_emit = Instant::now();

        loop {
            tokio::select! {
                biased;
                _ = control.cancel.notified() => {
                    cancelled = true;
                    break;
                }
                _ = ticker.tick() => {
                    if control.cancelled.load(Ordering::SeqCst) {
                        cancelled = true;
                        break;
                    }
                    if last_emit.elapsed() >= Duration::from_millis(350) {
                        if let Some(current) = &progress {
                            self.apply_progress_scaled(&task.id, current, stage, section_index, total_sections);
                        }
                        last_emit = Instant::now();
                    }
                }
                incoming = rx.recv() => {
                    match incoming {
                        None => break,
                        Some(line) => {
                            if line.from_stdout && line.text.starts_with(PROGRESS_PREFIX) {
                                if let Some(parsed) = parse_progress(&line.text) {
                                    progress = Some(parsed);
                                }
                                continue;
                            }
                            if stage == DownloadStatus::Fetching && stage_marker(&line.text) {
                                stage = DownloadStatus::Processing;
                                self.apply_progress_scaled(
                                    &task.id,
                                    progress.as_ref().unwrap_or(&Progress::empty()),
                                    stage,
                                    section_index,
                                    total_sections,
                                );
                            }
                            if !line.from_stdout {
                                let trimmed = line.text.trim();
                                if !trimmed.is_empty() {
                                    if stderr_tail.len() >= 80 {
                                        stderr_tail.pop_front();
                                    }
                                    stderr_tail.push_back(trimmed.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        if cancelled {
            if let Some(pid) = *lock(&control.pid) {
                process_manager::kill_tree(pid);
            }
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            cleanup_tmp_root(&tmp_root).await;
            return Err(CommandError::new("CANCELLED", "Download cancelled."));
        }

        let status = match tokio::time::timeout(Duration::from_secs(120), child.wait()).await {
            Ok(result) => result.map_err(|err| {
                CommandError::new("PROCESS_FAILED", "yt-dlp stopped unexpectedly.")
                    .with_detail(err.to_string())
            })?,
            Err(_) => {
                if let Some(pid) = *lock(&control.pid) {
                    process_manager::kill_tree(pid);
                }
                let _ = child.start_kill();
                let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
                cleanup_tmp_root(&tmp_root).await;
                return Err(CommandError::new(
                    "PROCESS_TIMEOUT",
                    "The download stalled and was stopped. Try again.",
                ));
            }
        };

        if control.cancelled.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            cleanup_tmp_root(&tmp_root).await;
            return Err(CommandError::new("CANCELLED", "Download cancelled."));
        }

        if !status.success() {
            let stderr = stderr_tail
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            cleanup_tmp_root(&tmp_root).await;
            return Err(yt_dlp::map_error_for_settings(
                &stderr,
                "yt-dlp could not download this clip. The video may restrict downloads or the selected range may be unavailable.",
                settings,
            ));
        }

        self.apply_progress_scaled(
            &task.id,
            progress.as_ref().unwrap_or(&Progress::empty()),
            DownloadStatus::Processing,
            section_index,
            total_sections,
        );

        find_output(section_dir, &task.format).await.ok_or_else(|| {
            CommandError::new(
                "OUTPUT_MISSING",
                "The clip finished but no output file was produced. Try a slightly longer range.",
            )
        })
    }

    async fn execute(
        &self,
        task: &DownloadTask,
        control: &TaskControl,
    ) -> Result<Outcome, CommandError> {
        let settings = lock(&self.settings).clone();

        let yt_dlp_bin = binaries::resolve(Tool::YtDlp, &settings).ok_or_else(|| {
            CommandError::new(
                "YTDLP_MISSING",
                "yt-dlp was not found. Install it or set its location in Settings.",
            )
        })?;
        let ffmpeg_bin = binaries::resolve(Tool::Ffmpeg, &settings).ok_or_else(|| {
            CommandError::new(
                "FFMPEG_MISSING",
                "FFmpeg is required to cut sections. Set its location in Settings.",
            )
        })?;
        let ffmpeg_dir = ffmpeg_bin.parent().map(|p| p.to_path_buf());

        let output_dir = PathBuf::from(&settings.output_dir);
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|err| CommandError::new("OUTPUT_DIR_ERROR", err.to_string()))?;

        let tmp_root = output_dir.join(".ytcutter-tmp");
        let tmp_dir = tmp_root.join(&task.id);
        let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
        tokio::fs::create_dir_all(&tmp_dir)
            .await
            .map_err(|err| CommandError::new("TEMP_DIR_ERROR", err.to_string()))?;

        let sections = task.effective_sections();
        let total = sections.len();
        let mut parts: Vec<PathBuf> = Vec::with_capacity(total);

        for (index, section) in sections.iter().enumerate() {
            let section_dir = tmp_dir.join(format!("part{}", index));
            tokio::fs::create_dir_all(&section_dir)
                .await
                .map_err(|err| CommandError::new("TEMP_DIR_ERROR", err.to_string()))?;

            let part = self
                .run_section(
                    task,
                    control,
                    &settings,
                    section,
                    index,
                    total,
                    &section_dir,
                    &tmp_root,
                    &tmp_dir,
                    &yt_dlp_bin,
                    ffmpeg_dir.as_deref(),
                )
                .await?;
            parts.push(part);
        }

        let produced = if parts.len() == 1 {
            parts.remove(0)
        } else {
            let merged = tmp_dir.join("merged.mp4");
            concat_sections(&ffmpeg_bin, &parts, &merged).await?;
            merged
        };

        let ext = produced
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| task.format.clone());
        let base = sanitize_filename(&task.file_base);
        let destination = unique_path(&output_dir, &base, &ext).await;

        move_file(&produced, &destination).await.map_err(|err| {
            CommandError::new(
                "OUTPUT_WRITE_FAILED",
                "Could not save the clip to the output folder.",
            )
            .with_detail(err.to_string())
        })?;

        let size = tokio::fs::metadata(&destination)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let probe = match binaries::resolve(Tool::Ffprobe, &settings) {
            Some(ffprobe) => ffmpeg::probe_media(&ffprobe, &destination).await,
            None => None,
        };

        let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
        cleanup_tmp_root(&tmp_root).await;

        Ok(Outcome {
            path: destination,
            size,
            duration_ms: probe.as_ref().and_then(|p| p.duration_ms),
            has_audio: probe.as_ref().map(|p| p.has_audio).unwrap_or(false),
            has_video: probe.as_ref().map(|p| p.has_video).unwrap_or(false),
        })
    }

    fn apply_progress_scaled(
        &self,
        id: &str,
        progress: &Progress,
        stage: DownloadStatus,
        section_index: usize,
        total_sections: usize,
    ) {
        {
            let mut inner = lock(&self.inner);
            let Some(task) = inner.tasks.iter_mut().find(|t| t.id == id) else {
                return;
            };
            if matches!(
                task.status,
                DownloadStatus::Completed | DownloadStatus::Cancelled | DownloadStatus::Failed
            ) {
                return;
            }
            task.status = stage;
            task.downloaded_bytes = progress.downloaded;
            task.total_bytes = progress.total.or(progress.estimate);
            task.speed_bps = progress.speed;
            task.eta_secs = progress.eta;
            let local = match (progress.downloaded, task.total_bytes) {
                (Some(done), Some(total)) if total > 0 => {
                    (done as f32 / total as f32).clamp(0.0, 1.0)
                }
                _ => 0.0,
            };
            task.progress = if total_sections > 1 {
                ((section_index as f32 + local) / total_sections as f32).clamp(0.0, 0.995)
            } else {
                local.clamp(0.0, 0.995)
            };
        }
        self.emit_task(id);
    }

    fn emit_task(&self, id: &str) {
        let snapshot = {
            let inner = lock(&self.inner);
            inner.tasks.iter().find(|t| t.id == id).cloned()
        };
        if let Some(task) = snapshot {
            let _ = self.app.emit("download:update", task);
        }
    }

    pub fn cancel(&self, id: &str) -> Result<(), CommandError> {
        let control = lock(&self.inner).controls.get(id).cloned();
        if let Some(control) = control {
            control.cancelled.store(true, Ordering::SeqCst);
            control.cancel.notify_waiters();
            if let Some(pid) = *lock(&control.pid) {
                process_manager::kill_tree(pid);
            }
            return Ok(());
        }

        let mut inner = lock(&self.inner);
        let Some(task) = inner.tasks.iter_mut().find(|t| t.id == id) else {
            return Err(CommandError::new("DOWNLOAD_NOT_FOUND", "That download no longer exists."));
        };
        if task.status == DownloadStatus::Queued {
            task.status = DownloadStatus::Cancelled;
            task.finished_at = Some(now_ms());
        }
        drop(inner);
        self.emit_task(id);
        Ok(())
    }

    pub fn retry(&self, id: &str) -> Result<DownloadTask, CommandError> {
        let snapshot = {
            let mut inner = lock(&self.inner);
            let Some(task) = inner.tasks.iter_mut().find(|t| t.id == id) else {
                return Err(CommandError::new("DOWNLOAD_NOT_FOUND", "That download no longer exists."));
            };
            if matches!(
                task.status,
                DownloadStatus::Queued
                    | DownloadStatus::Fetching
                    | DownloadStatus::Processing
                    | DownloadStatus::Completed
            ) {
                return Err(CommandError::new(
                    "DOWNLOAD_BUSY",
                    "Only failed or cancelled downloads can be retried.",
                ));
            }
            task.reset_for_retry();
            task.clone()
        };
        self.emit_task(id);
        Ok(snapshot)
    }

    pub fn remove(&self, id: &str) -> Result<(), CommandError> {
        let _ = self.cancel(id);
        let mut inner = lock(&self.inner);
        let before = inner.tasks.len();
        inner.tasks.retain(|t| t.id != id);
        if inner.tasks.len() == before {
            return Err(CommandError::new("DOWNLOAD_NOT_FOUND", "That download no longer exists."));
        }
        Ok(())
    }

    pub fn clear_finished(&self) -> Vec<DownloadTask> {
        let mut inner = lock(&self.inner);
        inner.tasks.retain(|t| {
            matches!(
                t.status,
                DownloadStatus::Queued | DownloadStatus::Fetching | DownloadStatus::Processing
            )
        });
        inner.tasks.clone()
    }

    pub fn shutdown(&self) {
        let controls: Vec<TaskControl> = lock(&self.inner).controls.values().cloned().collect();
        for control in controls {
            control.cancelled.store(true, Ordering::SeqCst);
            control.cancel.notify_waiters();
            if let Some(pid) = *lock(&control.pid) {
                process_manager::kill_tree(pid);
            }
        }
    }
}

async fn cleanup_tmp_root(tmp_root: &Path) {
    let _ = tokio::fs::remove_dir(tmp_root).await;
}
