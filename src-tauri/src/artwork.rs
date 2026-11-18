//! Network and image primitives for metadata: TMDB API requests, a local
//! cache of TMDB images, and ffmpeg frame grabs for files TMDB can't cover.
//! Requests are pinned to TMDB hosts so the webview can't use these commands
//! as a general-purpose HTTP client.

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

const API: &str = "https://api.themoviedb.org/3";
const IMG: &str = "https://image.tmdb.org/t/p";
const IMG_SIZES: &[&str] = &["w185", "w300", "w342", "w500", "w780", "w1280", "original"];

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("OffPlayer/0.1")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("http client")
    })
}

pub(crate) fn data_dir<R: Runtime>(app: &AppHandle<R>, sub: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-'))
}

/// GET a TMDB v3 endpoint. `key` is a v3 API key or a v4 read access token.
#[tauri::command]
pub async fn tmdb_get(
    path: String,
    params: HashMap<String, String>,
    key: String,
) -> Result<Value, String> {
    if !path.starts_with('/') || !safe_segment(&path[1..]) {
        return Err(format!("Bad TMDB path: {path}"));
    }
    let mut req = client().get(format!("{API}{path}")).query(&params);
    let key = key.trim();
    req = if key.starts_with("eyJ") {
        req.bearer_auth(key)
    } else {
        req.query(&[("api_key", key)])
    };
    let res = req.send().await.map_err(|e| format!("TMDB unreachable: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("TMDB response: {e}"))?;
    if !status.is_success() {
        let msg = body
            .get("status_message")
            .and_then(|m| m.as_str())
            .unwrap_or("request failed");
        return Err(format!("TMDB {}: {msg}", status.as_u16()));
    }
    Ok(body)
}

/// Download a TMDB image once and return its local path. `file` is a TMDB
/// `file_path` such as `/abc123.jpg`.
#[tauri::command]
pub async fn cache_tmdb_image<R: Runtime>(
    app: AppHandle<R>,
    file: String,
    size: String,
) -> Result<String, String> {
    let name = file.strip_prefix('/').unwrap_or(&file);
    let (stem, ext) = name.rsplit_once('.').ok_or("Bad image path")?;
    if !safe_segment(stem) || stem.contains('/') || !matches!(ext, "jpg" | "png" | "svg") {
        return Err(format!("Bad image path: {file}"));
    }
    if !IMG_SIZES.contains(&size.as_str()) {
        return Err(format!("Bad image size: {size}"));
    }
    let dir = data_dir(&app, &format!("artwork/{size}"))?;
    let dest = dir.join(name);
    if dest.exists() {
        return Ok(dest.to_string_lossy().into_owned());
    }
    let res = client()
        .get(format!("{IMG}/{size}/{name}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Image {}: HTTP {}", name, res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let tmp = dest.with_extension(format!("{ext}.part"));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

pub(crate) fn check_fingerprint(fp: &str) -> Result<(), String> {
    if fp.is_empty() || !fp.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Bad fingerprint".into());
    }
    Ok(())
}

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Save a representative frame near `at` seconds as a 480px-wide JPEG, named
/// by the file's fingerprint. ffmpeg's `thumbnail` filter picks the most
/// typical of the next frames, which avoids black and mid-fade frames.
/// Corrects anamorphic pixels (e.g. DVD 720×480 → 4:3).
#[tauri::command]
pub async fn grab_frame<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    at: f64,
    fingerprint: String,
    force: Option<bool>,
) -> Result<String, String> {
    check_fingerprint(&fingerprint)?;
    // A forced re-grab gets a new name so the webview can't show a cached old image.
    let force = force.unwrap_or(false);
    let name = if force { format!("{fingerprint}.r.jpg") } else { format!("{fingerprint}.jpg") };
    let dest = data_dir(&app, "thumbs")?.join(name);
    if dest.exists() && !force {
        return Ok(dest.to_string_lossy().into_owned());
    }
    let src = PathBuf::from(&path);
    let out = dest.clone();
    tauri::async_runtime::spawn_blocking(move || run_ffmpeg_grab(&src, at.max(0.0), &out))
        .await
        .map_err(|e| e.to_string())??;
    Ok(dest.to_string_lossy().into_owned())
}

fn run_ffmpeg_grab(src: &Path, at: f64, out: &Path) -> Result<(), String> {
    let tmp = out.with_extension("part.jpg");
    let mut cmd = crate::tools::command("ffmpeg");
    cmd.args(["-v", "error", "-y", "-ss", &format!("{at:.2}"), "-i"])
        .arg(src)
        .args([
            "-an",
            "-sn",
            "-frames:v",
            "1",
            "-vf",
            "thumbnail=n=48,scale=iw*sar:ih,setsar=1,scale=480:-2",
            "-q:v",
            "4",
        ])
        .arg(&tmp);
    no_window(&mut cmd);
    let res = cmd
        .output()
        .map_err(|e| format!("ffmpeg not runnable ({e}). Is ffmpeg installed and on PATH?"))?;
    if !res.status.success() || !tmp.exists() {
        let _ = std::fs::remove_file(&tmp);
        return Err(String::from_utf8_lossy(&res.stderr).trim().to_string());
    }
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())
}

/// Of the given image paths, those smaller than `max_bytes`: a near-black
/// 480px JPEG compresses to a few KB, so size is a cheap darkness test.
#[tauri::command]
pub fn small_images(paths: Vec<String>, max_bytes: u64) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| std::fs::metadata(p).map(|m| m.len() < max_bytes).unwrap_or(false))
        .collect()
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Storyboard {
    /// Absolute paths of the sprite sheets, in order.
    sheets: Vec<String>,
    /// Seconds between tiles.
    interval: f64,
    cols: u32,
    rows: u32,
    /// Number of real tiles (the last sheet may be padded).
    count: u32,
}

const SB_COLS: u32 = 10;
const SB_ROWS: u32 = 10;

/// Sprite sheets of small frames for scrubber previews, built once per file
/// from keyframes only (a 45-minute episode takes ~5 s).
#[tauri::command]
pub async fn storyboard<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    fingerprint: String,
    duration: f64,
) -> Result<Storyboard, String> {
    check_fingerprint(&fingerprint)?;
    if !(duration > 0.0) {
        return Err("Unknown duration".into());
    }
    let root = data_dir(&app, "thumbs/sb")?;
    let dir = root.join(&fingerprint);
    let meta = dir.join("storyboard.json");
    if let Ok(text) = std::fs::read_to_string(&meta) {
        if let Ok(sb) = serde_json::from_str::<Storyboard>(&text) {
            return Ok(sb);
        }
    }
    // At most ~300 tiles; never closer than 5 s apart.
    let interval = (duration / 300.0).ceil().max(5.0);
    let count = (duration / interval).ceil() as u32;
    let tmp = root.join(format!("{fingerprint}.part"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let src = PathBuf::from(&path);
    let tmp2 = tmp.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut cmd = crate::tools::command("ffmpeg");
        cmd.args(["-v", "error", "-y", "-skip_frame", "nokey", "-i"])
            .arg(&src)
            .args([
                "-an",
                "-sn",
                "-vf",
                &format!(
                    "fps=1/{interval},scale=iw*sar:ih,setsar=1,scale=240:-2:flags=fast_bilinear,tile={SB_COLS}x{SB_ROWS}"
                ),
                "-q:v",
                "5",
            ])
            .arg(tmp2.join("sb_%03d.jpg"));
        no_window(&mut cmd);
        let out = cmd
            .output()
            .map_err(|e| format!("ffmpeg not runnable ({e}). Is ffmpeg installed and on PATH?"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&tmp, &dir).map_err(|e| e.to_string())?;
    let mut sheets: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "jpg").unwrap_or(false))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    sheets.sort();
    if sheets.is_empty() {
        return Err("ffmpeg produced no frames".into());
    }
    let sb = Storyboard { sheets, interval, cols: SB_COLS, rows: SB_ROWS, count };
    let _ = std::fs::write(&meta, serde_json::to_string(&sb).unwrap_or_default());
    Ok(sb)
}
