//! Export / import of the user's data (a JSON file they pick in a dialog) and
//! IMDb export files (CSV). Limited to those extensions and a sane size so
//! these commands can't be used to read or write arbitrary files.

use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: u64 = 50 * 1024 * 1024;

fn allowed(path: &str) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(ext.as_str(), "json" | "csv") { Ok(()) } else { Err("Only .json and .csv files".into()) }
}

#[tauri::command]
pub fn write_user_file(path: String, contents: String) -> Result<(), String> {
    allowed(&path)?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_user_file(path: String) -> Result<String, String> {
    allowed(&path)?;
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > MAX_BYTES {
        return Err("File is too large".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Open the folder holding automatic database backups.
#[tauri::command]
pub fn open_backups<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}
