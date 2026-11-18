//! Where to find ffmpeg and ffprobe: the copies bundled with the app first,
//! then whatever is on PATH. Without either, scanning still works from file
//! names and playback is unaffected; only thumbnails and durations are missing.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

static BUNDLED: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Called once at start-up.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("lib").join("ffmpeg"))
        .filter(|d| d.join("ffprobe.exe").exists());
    let _ = BUNDLED.set(dir);
}

/// A Command for `name` ("ffmpeg" or "ffprobe").
pub fn command(name: &str) -> Command {
    if let Some(Some(dir)) = BUNDLED.get() {
        let exe = dir.join(format!("{name}.exe"));
        if exe.exists() {
            return Command::new(exe);
        }
    }
    Command::new(name)
}

fn runs(name: &str) -> bool {
    let mut cmd = command(name);
    cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

#[derive(serde::Serialize)]
pub struct ToolStatus {
    ffmpeg: bool,
    ffprobe: bool,
    bundled: bool,
}

/// Whether thumbnails and probing are available, for the Manage page.
#[tauri::command]
pub async fn tool_status() -> ToolStatus {
    tauri::async_runtime::spawn_blocking(|| ToolStatus {
        ffmpeg: runs("ffmpeg"),
        ffprobe: runs("ffprobe"),
        bundled: matches!(BUNDLED.get(), Some(Some(_))),
    })
    .await
    .unwrap_or(ToolStatus { ffmpeg: false, ffprobe: false, bundled: false })
}
