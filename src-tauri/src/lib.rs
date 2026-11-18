mod artwork;
mod backup;
mod files;
mod imdb;
mod media;
mod power;
mod segments;
mod tools;

use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:offplayer.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "library schema",
            sql: include_str!("../migrations/001_library.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "tmdb metadata",
            sql: include_str!("../migrations/002_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "watch state",
            sql: include_str!("../migrations/003_watch_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "watchlist",
            sql: include_str!("../migrations/004_watchlist.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "watched and recommendations",
            sql: include_str!("../migrations/005_watched_and_recs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "discover 2: lists, imdb, collections",
            sql: include_str!("../migrations/006_discover2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "skip intro: segments",
            sql: include_str!("../migrations/007_segments.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Runs before the front end opens the database, so before migrations.
        .setup(|app| {
            backup::before_migrations(app.handle());
            tools::init(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Remember size, position and maximised state between launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_libmpv::init())
        .invoke_handler(tauri::generate_handler![
            media::list_media,
            media::inspect_media,
            media::seed_libraries,
            media::dev_start_muted,
            artwork::tmdb_get,
            artwork::cache_tmdb_image,
            artwork::grab_frame,
            artwork::small_images,
            artwork::storyboard,
            imdb::imdb_sync,
            imdb::imdb_cancel,
            segments::segment_fingerprint,
            segments::segment_match,
            segments::segment_cache_prune,
            segments::segment_intro_tail,
            segments::media_chapters,
            tools::tool_status,
            files::write_user_file,
            files::read_user_file,
            files::open_backups,
            power::set_keep_awake
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
