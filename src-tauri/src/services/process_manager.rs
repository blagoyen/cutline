use std::path::Path;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::error::{CmdResult, CommandError};

pub struct ProcessOutput {
    pub success: bool,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Keep child consoles from flashing a window on Windows.
#[cfg(windows)]
pub fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_command: &mut Command) {}

/// Terminate a process and every child it spawned (yt-dlp spawns FFmpeg).
#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(windows))]
pub fn kill_tree(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output();
}

async fn read_all<R>(mut stream: R) -> String
where
    R: AsyncRead + Unpin,
{
    let mut buffer = Vec::new();
    let _ = stream.read_to_end(&mut buffer).await;
    String::from_utf8_lossy(&buffer).into_owned()
}

/// Run a tool to completion, capturing stdout/stderr, with a hard timeout.
pub async fn run_capture(
    program: &Path,
    args: &[String],
    timeout: Duration,
) -> CmdResult<ProcessOutput> {
    run_capture_in(program, args, timeout, None).await
}

/// Same as `run_capture`, with an optional working directory.
pub async fn run_capture_in(
    program: &Path,
    args: &[String],
    timeout: Duration,
    current_dir: Option<&Path>,
) -> CmdResult<ProcessOutput> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|err| {
        CommandError::new(
            "PROCESS_SPAWN_FAILED",
            format!(
                "Could not start {}. Check the configured executable path.",
                program.display()
            ),
        )
        .with_detail(err.to_string())
    })?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = stdout.map(|s| tokio::spawn(read_all(s)));
    let stderr_task = stderr.map(|s| tokio::spawn(read_all(s)));

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => {
            let status = status?;
            let stdout = match stdout_task {
                Some(task) => task.await.unwrap_or_default(),
                None => String::new(),
            };
            let stderr = match stderr_task {
                Some(task) => task.await.unwrap_or_default(),
                None => String::new(),
            };
            Ok(ProcessOutput {
                success: status.success(),
                timed_out: false,
                stdout,
                stderr,
            })
        }
        Err(_) => {
            if let Some(pid) = pid {
                kill_tree(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            if let Some(task) = stdout_task {
                task.abort();
            }
            if let Some(task) = stderr_task {
                task.abort();
            }
            Ok(ProcessOutput {
                success: false,
                timed_out: true,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }
}
