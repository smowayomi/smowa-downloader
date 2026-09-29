use crate::hidden;
use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Manager;
pub static TOOLS: OnceLock<PathBuf> = OnceLock::new();
#[derive(Clone, Serialize)]
pub struct ToolStage {
    name: String,
    stage: String,
}
#[derive(Clone, Serialize)]
pub struct Status {
    busy: bool,
    message: String,
    tools: Vec<ToolStage>,
}
struct Data {
    status: Status,
    checked_this_session: bool,
    attempted: Option<Instant>,
}
struct Engine(Mutex<Data>);
pub fn initialize(app: &tauri::AppHandle, dir: &Path) {
    let _ = TOOLS.set(dir.join("tools"));
    app.manage(Engine(Mutex::new(Data {
        status: Status {
            busy: false,
            message: String::new(),
            tools: vec![],
        },
        checked_this_session: false,
        attempted: None,
    })));
    let app = app.clone();
    let checked = dir.join("engine-last-check");
    std::thread::spawn(move || loop {
        let stale = std::fs::metadata(&checked)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_none_or(|age| age.as_secs() > 86400);
        let due = {
            let state = app.state::<Engine>();
            let d = state.0.lock().unwrap();
            !d.status.busy
                && (!d.checked_this_session || stale)
                && d.attempted
                    .is_none_or(|t| t.elapsed() >= Duration::from_secs(60))
        };
        if due {
            let _ = prepare_engine(app.clone());
        }
        std::thread::sleep(Duration::from_secs(10));
    });
}
pub fn is_busy(app: &tauri::AppHandle) -> bool {
    app.state::<Engine>().0.lock().unwrap().status.busy
}
pub fn ensure_ready(app: &tauri::AppHandle) -> Result<(), String> {
    if is_busy(app) {
        return Err("Download tools are being prepared. Please wait for setup to finish.".into());
    }
    if ["yt-dlp", "ffmpeg", "ffprobe", "node"]
        .iter()
        .any(|name| !crate::tool(name).is_file())
    {
        return Err("Download tools are not ready. Open Settings and retry tool setup.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn engine_status(app: tauri::AppHandle) -> String {
    app.state::<Engine>()
        .0
        .lock()
        .unwrap()
        .status
        .message
        .clone()
}
#[tauri::command]
pub fn engine_details(app: tauri::AppHandle) -> Status {
    app.state::<Engine>().0.lock().unwrap().status.clone()
}
fn finish(d: &mut Data, result: Result<(), String>, marker: &Path) {
    d.status.busy = false;
    match result {
        Ok(()) => {
            d.checked_this_session = true;
            d.status.message.clear();
            let _ = std::fs::write(marker, b"checked");
        }
        Err(error) => {
            d.checked_this_session = false;
            for tool in &mut d.status.tools {
                if tool.stage != "Ready" && tool.stage != "Waiting" {
                    tool.stage = "Failed".into();
                }
            }
            d.status.message = format!(
                "Tool setup failed: {error}. Retrying shortly; you can also retry in Settings."
            );
        }
    }
}
#[tauri::command]
pub fn prepare_engine(app: tauri::AppHandle) -> Result<(), String> {
    let shared = app.state::<crate::Shared>();
    let downloads = shared.0.lock().unwrap();
    if downloads.installing_update
        || !downloads.processes.is_empty()
        || downloads
            .jobs
            .iter()
            .any(|j| ["queued", "downloading", "processing"].contains(&j.status.as_str()))
    {
        return Err("Wait until downloads finish before updating tools.".into());
    }
    {
        let state = app.state::<Engine>();
        let mut d = state.0.lock().unwrap();
        if d.status.busy {
            return Ok(());
        }
        d.attempted = Some(Instant::now());
        d.status = Status {
            busy: true,
            message: "Setting up download tools...".into(),
            tools: ["yt-dlp", "FFmpeg", "Node.js"]
                .iter()
                .map(|name| ToolStage {
                    name: (*name).into(),
                    stage: "Waiting".into(),
                })
                .collect(),
        };
    }
    drop(downloads);
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
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
            let mut child = hidden(
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
                    .arg("-DownloadMissing")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped()),
            )
            .spawn()
            .map_err(|e| e.to_string())?;
            let stderr = child.stderr.take().unwrap();
            let errors = std::thread::spawn(move || {
                let mut tail = std::collections::VecDeque::new();
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if tail.len() == 20 {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
                tail.into_iter().collect::<Vec<_>>().join("\n")
            });
            for line in BufReader::new(child.stdout.take().unwrap())
                .lines()
                .map_while(Result::ok)
            {
                if let Some((name, stage)) = line
                    .strip_prefix("SMOWA_TOOL:")
                    .and_then(|s| s.split_once('|'))
                {
                    let state = app.state::<Engine>();
                    let mut d = state.0.lock().unwrap();
                    if let Some(tool) = d.status.tools.iter_mut().find(|t| t.name == name) {
                        tool.stage = stage.into();
                    }
                    d.status.message = format!("Setting up {name}: {stage}");
                }
            }
            let status = child.wait().map_err(|e| e.to_string())?;
            let error = errors.join().unwrap_or_default();
            if !status.success() {
                return Err(error.chars().take(400).collect());
            }
            if ["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "node.exe"]
                .iter()
                .any(|n| !TOOLS.get().unwrap().join(n).is_file())
            {
                return Err("A required tool is missing after setup".into());
            }
            Ok(())
        })();
        let marker = TOOLS
            .get()
            .unwrap()
            .parent()
            .unwrap()
            .join("engine-last-check");
        finish(
            &mut app.state::<Engine>().0.lock().unwrap(),
            result,
            &marker,
        );
    });
    Ok(())
}
#[test]
fn setup_marks_success_only_after_completion() {
    let dir = std::env::temp_dir().join(format!("smowa-engine-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let marker = dir.join("checked");
    let mut data = Data {
        status: Status {
            busy: true,
            message: String::new(),
            tools: vec![],
        },
        checked_this_session: false,
        attempted: None,
    };
    finish(&mut data, Err("network failed".into()), &marker);
    assert!(!marker.exists());
    assert!(!data.checked_this_session);
    assert!(!data.status.busy);
    finish(&mut data, Ok(()), &marker);
    assert!(marker.exists());
    assert!(data.checked_this_session);
    std::fs::remove_file(marker).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
