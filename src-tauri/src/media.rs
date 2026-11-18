//! Filesystem and probing primitives for the library scanner.
//! Parsing, grouping and database writes live in TypeScript (src/library).

use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;
use xxhash_rust::xxh3::Xxh3;

const VIDEO_EXT: &[&str] = &[
    "mkv", "mp4", "m4v", "avi", "mov", "wmv", "ts", "m2ts", "webm", "mpg", "mpeg", "flv", "ogm",
    "divx",
];
const SUB_EXT: &[&str] = &["srt", "ass", "ssa", "vtt", "sub", "idx", "sup"];

#[derive(Serialize)]
pub struct MediaEntry {
    /// Absolute path.
    path: String,
    /// Path relative to the scanned root, with `/` separators.
    rel: String,
    size: u64,
    /// Modified time, ms since epoch.
    mtime: u64,
    kind: &'static str,
}

/// Walk `root` and return every video and subtitle file under it.
#[tauri::command]
pub async fn list_media(root: String) -> Result<Vec<MediaEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = Path::new(&root);
        if !root_path.is_dir() {
            return Err(format!("Not a folder: {root}"));
        }
        let mut out = Vec::new();
        for entry in WalkDir::new(root_path)
            .follow_links(true)
            .into_iter()
            .filter_entry(|e| {
                // Skip hidden and system folders such as $RECYCLE.BIN.
                let name = e.file_name().to_string_lossy();
                e.depth() == 0 || !(name.starts_with('.') || name.starts_with('$'))
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let kind = if VIDEO_EXT.contains(&ext.as_str()) {
                "video"
            } else if SUB_EXT.contains(&ext.as_str()) {
                "sub"
            } else {
                continue;
            };
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let rel = path
                .strip_prefix(root_path)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(MediaEntry {
                path: path.to_string_lossy().into_owned(),
                rel,
                size: meta.len(),
                mtime,
                kind,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Default)]
pub struct VideoInfo {
    codec: Option<String>,
    width: Option<u64>,
    height: Option<u64>,
    bit_depth: Option<u64>,
}

#[derive(Serialize)]
pub struct AudioInfo {
    codec: Option<String>,
    channels: Option<u64>,
    lang: Option<String>,
    title: Option<String>,
    default: bool,
}

#[derive(Serialize)]
pub struct SubInfo {
    codec: Option<String>,
    lang: Option<String>,
    title: Option<String>,
    forced: bool,
}

#[derive(Serialize)]
pub struct Inspection {
    fingerprint: String,
    duration: Option<f64>,
    video: VideoInfo,
    audio: Vec<AudioInfo>,
    subs: Vec<SubInfo>,
    chapters: usize,
    error: Option<String>,
}

/// Stable identity for a file that survives renames and moves:
/// size + xxh3 of the first and last 64 KiB.
fn fingerprint(path: &Path) -> std::io::Result<String> {
    const CHUNK: u64 = 64 * 1024;
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let mut h = Xxh3::new();
    let mut buf = vec![0u8; CHUNK as usize];
    let n = f.read(&mut buf)?;
    h.update(&buf[..n]);
    if size > CHUNK * 2 {
        f.seek(SeekFrom::End(-(CHUNK as i64)))?;
        let n = f.read(&mut buf)?;
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}-{:016x}", size, h.digest()))
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|x| x.to_string())
}
fn tag(v: &Value, k: &str) -> Option<String> {
    v.get("tags").and_then(|t| t.get(k)).and_then(|x| x.as_str()).map(|x| x.to_string())
}
fn flag(v: &Value, k: &str) -> bool {
    v.get("disposition").and_then(|d| d.get(k)).and_then(|x| x.as_i64()) == Some(1)
}

fn run_ffprobe(path: &Path) -> Result<Value, String> {
    let mut cmd = crate::tools::command("ffprobe");
    cmd.args([
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
    ])
    .arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash per file
    }
    let out = cmd
        .output()
        .map_err(|e| format!("ffprobe not runnable ({e}). Is ffmpeg installed and on PATH?"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// Fingerprint and ffprobe one file. Probe failures are reported in `error`
/// rather than failing the call, so one bad file never stops a scan.
#[tauri::command]
pub async fn inspect_media(path: String) -> Result<Inspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let fingerprint = fingerprint(p).map_err(|e| format!("{path}: {e}"))?;
        let mut info = Inspection {
            fingerprint,
            duration: None,
            video: VideoInfo::default(),
            audio: vec![],
            subs: vec![],
            chapters: 0,
            error: None,
        };
        let json = match run_ffprobe(p) {
            Ok(j) => j,
            Err(e) => {
                info.error = Some(e);
                return Ok(info);
            }
        };
        info.duration = json
            .get("format")
            .and_then(|f| s(f, "duration"))
            .and_then(|d| d.parse().ok());
        info.chapters = json
            .get("chapters")
            .and_then(|c| c.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let mut have_video = false;
        for st in json.get("streams").and_then(|x| x.as_array()).into_iter().flatten() {
            match st.get("codec_type").and_then(|x| x.as_str()) {
                Some("video") if !have_video && !flag(st, "attached_pic") => {
                    have_video = true;
                    let depth = s(st, "bits_per_raw_sample")
                        .and_then(|b| b.parse().ok())
                        .or_else(|| {
                            s(st, "pix_fmt").map(|f| if f.contains("10") { 10 } else { 8 })
                        });
                    info.video = VideoInfo {
                        codec: s(st, "codec_name"),
                        width: st.get("width").and_then(|x| x.as_u64()),
                        height: st.get("height").and_then(|x| x.as_u64()),
                        bit_depth: depth,
                    };
                }
                Some("audio") => info.audio.push(AudioInfo {
                    codec: s(st, "codec_name"),
                    channels: st.get("channels").and_then(|x| x.as_u64()),
                    lang: tag(st, "language"),
                    title: tag(st, "title"),
                    default: flag(st, "default"),
                }),
                Some("subtitle") => info.subs.push(SubInfo {
                    codec: s(st, "codec_name"),
                    lang: tag(st, "language"),
                    title: tag(st, "title"),
                    forced: flag(st, "forced"),
                }),
                _ => {}
            }
        }
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dev/test hook: OFFPLAYER_START_MUTED makes the player start muted, so
/// automated checks don't play sound.
#[tauri::command]
pub fn dev_start_muted() -> bool {
    std::env::var_os("OFFPLAYER_START_MUTED").is_some()
}

/// Dev/test hook: folders listed in OFFPLAYER_SEED_LIBRARIES (separated by `;`)
/// are added as libraries on start-up when the library list is empty.
#[tauri::command]
pub fn seed_libraries() -> Vec<String> {
    std::env::var("OFFPLAYER_SEED_LIBRARIES")
        .map(|v| {
            v.split(';')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}
