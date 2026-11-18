//! Keep the display and system awake while a video is playing.
//!
//! `SetThreadExecutionState(ES_CONTINUOUS | …)` holds only while the calling
//! thread lives, so a dedicated thread owns the state and commands send it
//! on/off over a channel.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn SetThreadExecutionState(flags: u32) -> u32;
}

#[cfg(windows)]
const ES_CONTINUOUS: u32 = 0x8000_0000;
#[cfg(windows)]
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
#[cfg(windows)]
const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

fn worker() -> &'static Mutex<Sender<bool>> {
    static TX: OnceLock<Mutex<Sender<bool>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = channel::<bool>();
        std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || {
                for on in rx {
                    #[cfg(windows)]
                    unsafe {
                        SetThreadExecutionState(if on {
                            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                        } else {
                            ES_CONTINUOUS
                        });
                    }
                    #[cfg(not(windows))]
                    let _ = on;
                }
            })
            .expect("keep-awake thread");
        Mutex::new(tx)
    })
}

/// Called by the player: true while playing, false when paused or closed.
#[tauri::command]
pub fn set_keep_awake(on: bool) {
    if let Ok(tx) = worker().lock() {
        let _ = tx.send(on);
    }
}
