//! Safety net for schema changes: before the front end opens the database (and
//! the SQL plugin applies any new migrations), copy it aside whenever this is
//! the first launch of a different app version. Keeps the three newest copies.

use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

const KEEP: usize = 3;

pub fn before_migrations<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = run(app) {
        eprintln!("database backup skipped: {e}");
    }
}

fn run<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let db = dir.join("offplayer.db");
    if !db.exists() {
        return Ok(());
    }
    let version = app.package_info().version.to_string();
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let marker = backups.join("last-version.txt");
    let previous = std::fs::read_to_string(&marker).unwrap_or_default().trim().to_string();
    if previous == version {
        return Ok(());
    }
    let label = if previous.is_empty() { "before-".to_string() + &version } else { previous };
    let stamp = chrono_like_stamp();
    let dest = backups.join(format!("offplayer-{label}-{stamp}.db"));
    copy_with_wal(&db, &dest)?;
    std::fs::write(&marker, &version).map_err(|e| e.to_string())?;
    prune(&backups);
    Ok(())
}

/// The database may have a write-ahead log beside it; copy it too so the
/// backup is complete.
fn copy_with_wal(db: &Path, dest: &Path) -> Result<(), String> {
    std::fs::copy(db, dest).map_err(|e| e.to_string())?;
    for ext in ["db-wal", "db-shm"] {
        let side = db.with_extension(ext);
        if side.exists() {
            let _ = std::fs::copy(&side, dest.with_extension(ext));
        }
    }
    Ok(())
}

fn prune(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut dbs: Vec<_> = read
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "db").unwrap_or(false))
        .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (t, p)))
        .collect();
    dbs.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in dbs.into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(&p);
        for ext in ["db-wal", "db-shm"] {
            let _ = std::fs::remove_file(p.with_extension(ext));
        }
    }
}

/// YYYYMMDD-HHMMSS (UTC) without pulling in a date crate.
fn chrono_like_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}")
}
