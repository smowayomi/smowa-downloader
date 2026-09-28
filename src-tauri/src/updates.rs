use crate::{Manager, Shared};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    message: String,
    version: String,
    ready: bool,
    busy: bool,
}
struct Pending {
    update: Update,
    bytes: Vec<u8>,
}
struct Data {
    status: Status,
    pending: Option<Pending>,
    last_check: Option<Instant>,
    preferences: PathBuf,
}
struct Updater(Mutex<Data>);
#[derive(Serialize, Deserialize)]
struct Preferences {
    enabled: bool,
}

pub fn initialize(app: &tauri::AppHandle, dir: &std::path::Path) {
    let preferences = dir.join("updates.json");
    let enabled = std::fs::read(&preferences)
        .ok()
        .and_then(|b| serde_json::from_slice::<Preferences>(&b).ok())
        .map(|p| p.enabled)
        .unwrap_or(true);
    app.manage(Updater(Mutex::new(Data {
        status: Status {
            enabled,
            message: "Updates are checked automatically.".into(),
            version: app.package_info().version.to_string(),
            ready: false,
            busy: false,
        },
        pending: None,
        last_check: None,
        preferences,
    })));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            let _ = tauri::async_runtime::block_on(run(&app, false, false));
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}
#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> Status {
    app.state::<Updater>().0.lock().unwrap().status.clone()
}
#[tauri::command]
pub fn set_auto_updates(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<Updater>();
    let mut d = state.0.lock().unwrap();
    let bytes = serde_json::to_vec(&Preferences { enabled }).map_err(|e| e.to_string())?;
    std::fs::write(&d.preferences, bytes).map_err(|e| e.to_string())?;
    d.status.enabled = enabled;
    Ok(())
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<(), String> {
    run(&app, true, false).await
}
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    run(&app, true, true).await
}
async fn run(app: &tauri::AppHandle, force: bool, install: bool) -> Result<(), String> {
    let state = app.state::<Updater>();
    {
        let mut d = state.0.lock().unwrap();
        if d.status.busy || (!force && !d.status.enabled) {
            return Ok(());
        }
        if !force
            && d.pending.is_none()
            && d.last_check
                .is_some_and(|t| t.elapsed() < Duration::from_secs(6 * 60 * 60))
        {
            return Ok(());
        }
        d.status.busy = true;
    }
    let result = run_inner(app, force, install).await;
    let mut d = state.0.lock().unwrap();
    d.status.busy = false;
    if let Err(error) = &result {
        d.status.message = format!("Update unavailable: {error}. You can try again.");
    }
    result
}
async fn run_inner(app: &tauri::AppHandle, force: bool, install: bool) -> Result<(), String> {
    let state = app.state::<Updater>();
    let needs_check = state.0.lock().unwrap().pending.is_none();
    if needs_check {
        {
            let mut d = state.0.lock().unwrap();
            d.last_check = Some(Instant::now());
            d.status.message = "Checking for updates...".into();
        }
        let update = app
            .updater_builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        let Some(update) = update else {
            state.0.lock().unwrap().status.message = "You're up to date.".into();
            return Ok(());
        };
        state.0.lock().unwrap().status.message =
            format!("Downloading update {}...", update.version);
        // The plugin verifies the downloaded bytes against the embedded public key.
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        let mut d = state.0.lock().unwrap();
        d.status.ready = true;
        d.status.message = format!(
            "Update {} ready. It will install when downloads finish and the window is closed.",
            update.version
        );
        d.pending = Some(Pending { update, bytes });
    }
    let visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);
    let enabled = state.0.lock().unwrap().status.enabled;
    if !install && (force || visible || !enabled) {
        return Ok(());
    }
    let shared = app.state::<Shared>();
    {
        let mut downloads = shared.0.lock().unwrap();
        if !downloads.processes.is_empty()
            || !downloads.pending.is_empty()
            || downloads
                .jobs
                .iter()
                .any(|j| ["queued", "downloading", "processing"].contains(&j.status.as_str()))
            || crate::engine::is_busy(app)
        {
            state.0.lock().unwrap().status.message =
                "Update ready. Waiting for downloads to finish.".into();
            return Ok(());
        }
        downloads.installing_update = true;
    }
    let pending = state
        .0
        .lock()
        .unwrap()
        .pending
        .take()
        .ok_or("No update ready")?;
    let result = pending
        .update
        .install(&pending.bytes)
        .map_err(|e| e.to_string());
    // Windows installers normally terminate this process after starting successfully.
    if result.is_err() {
        shared.0.lock().unwrap().installing_update = false;
        state.0.lock().unwrap().pending = Some(pending);
    }
    result
}
