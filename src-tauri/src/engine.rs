use crate::hidden;
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};
use tauri::Manager;
pub static TOOLS: OnceLock<PathBuf> = OnceLock::new();
struct Engine(Mutex<String>);
pub fn initialize(app: &tauri::AppHandle, dir: &Path) {
    let _ = TOOLS.set(dir.join("tools"));
    app.manage(Engine(Mutex::new(String::new())));
    let app = app.clone();
    let checked = dir.join("engine-last-check");
    std::thread::spawn(move || {
        let mut first = true;
        loop {
            let due = std::fs::metadata(&checked)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_none_or(|age| age.as_secs() > 86400);
            let due = first || due;
            if due && prepare_engine(app.clone()).is_ok() {
                first = false;
                let _ = std::fs::write(&checked, b"checked");
            }
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}
pub fn is_busy(app: &tauri::AppHandle) -> bool {
    app.state::<Engine>()
        .0
        .lock()
        .unwrap()
        .starts_with("Setting up")
}
#[tauri::command]
pub fn engine_status(app: tauri::AppHandle) -> String {
    app.state::<Engine>().0.lock().unwrap().clone()
}
#[tauri::command]
pub fn prepare_engine(app: tauri::AppHandle) -> Result<(), String> {
    let shared = app.state::<crate::Shared>();
    let downloads = shared.0.lock().unwrap();
    if downloads.installing_update
        || downloads
            .jobs
            .iter()
            .any(|j| ["queued", "downloading", "processing"].contains(&j.status.as_str()))
    {
        return Err("Wait until downloads finish before updating tools.".into());
    }
    let state = app.state::<Engine>();
    {
        let mut s = state.0.lock().unwrap();
        if s.starts_with("Setting up") {
            return Ok(());
        }
        *s = "Setting up download tools. This may take a few minutes...".into();
    }
    drop(downloads);
    let script = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("App folder missing")?
        .join("scripts/setup-tools.ps1");
    let script = if script.exists() {
        script
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/setup-tools.ps1")
    };
    std::thread::spawn(move || {
        let result = hidden(
            Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                ])
                .arg(script)
                .arg("-Destination")
                .arg(TOOLS.get().unwrap())
                .arg("-DownloadMissing"),
        )
        .output();
        let message = match result {
            Ok(out) if out.status.success() => String::new(),
            Ok(out) => format!(
                "Tool setup failed: {}. Retry in Settings.",
                String::from_utf8_lossy(&out.stderr)
                    .chars()
                    .take(300)
                    .collect::<String>()
            ),
            Err(e) => format!("Tool setup failed: {e}. Retry in Settings."),
        };
        *app.state::<Engine>().0.lock().unwrap() = message;
    });
    Ok(())
}
