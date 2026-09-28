#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::{Deserialize, Serialize};
use smowa::{download_args, progress, validate_url, Options};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};

#[derive(Clone, Serialize, Deserialize)]
struct Job {
    id: String,
    title: String,
    url: String,
    status: String,
    percent: f64,
    speed: String,
    eta: String,
    error: String,
    file: String,
    created: u64,
    options: Options,
}
#[derive(Clone)]
struct Shared(Arc<Mutex<Data>>);
struct Data {
    jobs: Vec<Job>,
    processes: HashMap<String, u32>,
    pending: Vec<String>,
    history: PathBuf,
    storage_error: String,
}
fn hidden(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}
fn tool(name: &str) -> PathBuf {
    let local = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .join("tools")
        .join(format!("{name}.exe"));
    if local.exists() {
        local
    } else {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tools")
            .join(format!("{name}.exe"));
        if dev.exists() {
            dev
        } else {
            PathBuf::from(format!("{name}.exe"))
        }
    }
}
fn command() -> Command {
    let mut c = Command::new(tool("yt-dlp"));
    hidden(&mut c);
    c.args([
        "--ignore-config",
        "--no-playlist",
        "--no-colors",
        "--socket-timeout",
        "20",
        "--retries",
        "3",
    ]);
    let ff = tool("ffmpeg");
    if ff.exists() {
        c.arg("--ffmpeg-location").arg(ff.parent().unwrap());
    }
    let node = tool("node");
    c.arg("--js-runtimes")
        .arg(format!("node:{}", node.display()));
    c
}
fn save(d: &mut Data) {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let tmp = d.history.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&d.jobs)?)?;
        std::fs::rename(tmp, &d.history)?;
        Ok(())
    })();
    d.storage_error = result
        .err()
        .map(|e| format!("Could not save history: {e}"))
        .unwrap_or_default();
}
fn change(s: &Shared, id: &str, f: impl FnOnce(&mut Job), persist: bool) {
    let mut d = s.0.lock().unwrap();
    if let Some(j) = d.jobs.iter_mut().find(|j| j.id == id) {
        f(j);
    }
    if persist {
        save(&mut d);
    }
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn receive(app: &tauri::AppHandle, args: Vec<String>) {
    let incoming = args.windows(2).find_map(|pair| match pair[0].as_str() {
        "--url" => Some(validate_url(&pair[1])),
        "--open-link" => Some(smowa::parse_app_link(&pair[1])),
        _ => None,
    });
    if let Some(Ok(url)) = incoming {
        app.state::<Shared>().0.lock().unwrap().pending.push(url);
    }
    show(app);
}
#[tauri::command]
fn snapshot(state: State<Shared>) -> serde_json::Value {
    let mut d = state.0.lock().unwrap();
    serde_json::json!({"jobs":d.jobs,"pending":std::mem::take(&mut d.pending),"storageError":d.storage_error})
}
#[tauri::command]
async fn inspect_video(url: String) -> Result<serde_json::Value, String> {
    let url = validate_url(&url)?;
    tauri::async_runtime::spawn_blocking(move||{let out=command().args(["--dump-single-json","--skip-download","--",&url]).output().map_err(|e|format!("yt-dlp could not start. Run setup-tools.ps1. {e}"))?;if !out.status.success(){return Err(String::from_utf8_lossy(&out.stderr).chars().take(2500).collect());}let v:serde_json::Value=serde_json::from_slice(&out.stdout).map_err(|e|e.to_string())?;Ok(serde_json::json!({"title":v["title"],"thumbnail":v["thumbnail"],"duration":v["duration"],"uploader":v["uploader"],"formats":v["formats"],"audioOnly": v["vcodec"].as_str() == Some("none") || v["formats"].as_array().is_some_and(|fs| !fs.is_empty() && fs.iter().all(|f| f["vcodec"].as_str() == Some("none"))),"url":url}))}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn start_download(options: Options, title: String, state: State<Shared>) -> Result<String, String> {
    download_args(&options)?;
    std::fs::create_dir_all(&options.folder).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let job = Job {
        id: id.clone(),
        title: title.chars().take(300).collect(),
        url: options.url.clone(),
        status: "queued".into(),
        percent: 0.,
        speed: String::new(),
        eta: String::new(),
        error: String::new(),
        file: String::new(),
        created: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        options,
    };
    let mut d = state.0.lock().unwrap();
    d.jobs.insert(0, job);
    save(&mut d);
    Ok(id)
}
fn run_job(s: &Shared, job: Job) {
    let args = match download_args(&job.options) {
        Ok(a) => a,
        Err(e) => {
            change(
                s,
                &job.id,
                |j| {
                    j.status = "failed".into();
                    j.error = e;
                },
                true,
            );
            return;
        }
    };
    let mut c = command();
    c.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match c.spawn() {
        Ok(c) => c,
        Err(e) => {
            change(
                s,
                &job.id,
                |j| {
                    j.status = "failed".into();
                    j.error = format!("Could not start yt-dlp: {e}");
                },
                true,
            );
            return;
        }
    };
    // Publish PID under the same lock used by cancellation, closing the spawn/cancel race.
    {
        let mut d = s.0.lock().unwrap();
        if d.jobs
            .iter()
            .any(|j| j.id == job.id && j.status == "cancelled")
        {
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
        d.processes.insert(job.id.clone(), child.id());
    }
    let err = child.stderr.take().unwrap();
    let stderr = std::thread::spawn(move || {
        let mut tail = std::collections::VecDeque::new();
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            if tail.len() >= 20 {
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
        if let Some((p, speed, eta)) = progress(&line) {
            change(
                s,
                &job.id,
                |j| {
                    if j.status != "cancelled" {
                        j.percent = p;
                        j.speed = speed;
                        j.eta = eta;
                        j.status = "downloading".into();
                    }
                },
                false,
            );
        } else if let Some(file) = line.strip_prefix("SMOWA_FILE:") {
            change(s, &job.id, |j| j.file = file.into(), false);
        } else if line.contains("[Merger]")
            || line.contains("[ExtractAudio]")
            || line.contains("[VideoRemuxer]")
        {
            change(
                s,
                &job.id,
                |j| {
                    if j.status != "cancelled" {
                        j.status = "processing".into();
                    }
                },
                false,
            );
        }
    }
    let result = child.wait();
    let error = stderr.join().unwrap_or_default();
    s.0.lock().unwrap().processes.remove(&job.id);
    change(
        s,
        &job.id,
        |j| {
            if j.status == "cancelled" {
                return;
            }
            if result.is_ok_and(|r| r.success()) && !j.file.is_empty() {
                j.status = "completed".into();
                j.percent = 100.;
                j.speed.clear();
                j.eta.clear();
            } else {
                j.status = "failed".into();
                j.error = if error.is_empty() {
                    "The downloader exited without a completed file.".into()
                } else {
                    error
                };
            }
        },
        true,
    );
}
#[tauri::command]
fn cancel(id: String, state: State<Shared>) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    let job = d
        .jobs
        .iter_mut()
        .find(|j| j.id == id)
        .ok_or("Download not found")?;
    if !["queued", "downloading", "processing"].contains(&job.status.as_str()) {
        return Ok(());
    }
    job.status = "cancelled".into();
    if let Some(pid) = d.processes.get(&id) {
        let status = hidden(Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]))
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not stop the download process".into());
        }
    }
    save(&mut d);
    Ok(())
}
#[tauri::command]
fn retry(id: String, state: State<Shared>) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    if d.processes.contains_key(&id) {
        return Err("The previous process is still stopping. Try again in a moment.".into());
    }
    let j = d
        .jobs
        .iter_mut()
        .find(|j| j.id == id)
        .ok_or("Download not found")?;
    if !["failed", "cancelled", "interrupted"].contains(&j.status.as_str()) {
        return Err("Only stopped downloads can be retried".into());
    }
    j.status = "queued".into();
    j.error.clear();
    j.percent = 0.;
    j.file.clear();
    save(&mut d);
    Ok(())
}
#[tauri::command]
fn clear_history(state: State<Shared>) {
    let mut d = state.0.lock().unwrap();
    d.jobs
        .retain(|j| ["queued", "downloading", "processing"].contains(&j.status.as_str()));
    save(&mut d);
}
#[tauri::command]
fn reveal(id: String, state: State<Shared>) -> Result<(), String> {
    let d = state.0.lock().unwrap();
    let j = d
        .jobs
        .iter()
        .find(|j| j.id == id)
        .ok_or("Download not found")?;
    let p = PathBuf::from(&j.file);
    if j.status != "completed" || !p.is_file() {
        return Err("The downloaded file is no longer at its original location".into());
    }
    Command::new("explorer.exe")
        .arg(format!("/select,{}", p.display()))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn defaults(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({"folder":app.path().download_dir().map_err(|e|e.to_string())?.join("Smowa").to_string_lossy(),"extension":std::env::current_exe().unwrap().parent().unwrap().join("extension").to_string_lossy()}),
    )
}
#[tauri::command]
async fn health() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(|| {
        let mut map = serde_json::Map::new();
        for name in ["yt-dlp", "ffmpeg", "node"] {
            let output = hidden(Command::new(tool(name)).arg(if name == "ffmpeg" {
                "-version"
            } else {
                "--version"
            }))
            .output();
            map.insert(
                name.into(),
                serde_json::Value::Bool(output.is_ok_and(|o| o.status.success())),
            );
        }
        serde_json::Value::Object(map)
    })
    .await
    .unwrap_or_default()
}
#[tauri::command]
fn register_extension(extension_id: String, app: tauri::AppHandle) -> Result<(), String> {
    if extension_id.len() != 32 || !extension_id.bytes().all(|c| (b'a'..=b'p').contains(&c)) {
        return Err(
            "Enter the 32-letter extension ID from brave://extensions or chrome://extensions"
                .into(),
        );
    }
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("smowa-bridge.exe");
    if !exe.exists() {
        return Err("The native helper is missing. Use the complete release folder.".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("native-host.json");
    let data = serde_json::json!({"name":"com.smowa.downloader","description":"SmowaDL desktop downloader","path":exe,"type":"stdio","allowed_origins":[format!("chrome-extension://{extension_id}/")]});
    std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).map_err(|e| e.to_string())?;
    // Register explicitly for both browsers and both registry views. Brave can
    // fall back to Chrome's registration, but should not have to depend on it.
    for browser in [r"BraveSoftware\Brave-Browser", r"Google\Chrome"] {
        for view in ["/reg:32", "/reg:64"] {
            let key = format!(r"HKCU\Software\{browser}\NativeMessagingHosts\com.smowa.downloader");
            let output = hidden(
                Command::new("reg")
                    .args(["add", &key, "/ve", "/t", "REG_SZ", "/d"])
                    .arg(&path)
                    .args(["/f", view]),
            )
            .output()
            .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!(
                    "Could not register {browser} ({view}): {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
    }
    Ok(())
}
fn register_app_link() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let command = format!("\"{}\" --open-link \"%1\"", exe.display());
    for (key, name, value) in [
        (r"HKCU\Software\Classes\smowadl", "/ve", "URL:SmowaDL"),
        (r"HKCU\Software\Classes\smowadl", "URL Protocol", ""),
        (
            r"HKCU\Software\Classes\smowadl\shell\open\command",
            "/ve",
            command.as_str(),
        ),
    ] {
        let mut cmd = Command::new("reg");
        cmd.args(["add", key]);
        if name == "/ve" {
            cmd.arg("/ve");
        } else {
            cmd.args(["/v", name]);
        }
        let output = hidden(cmd.args(["/t", "REG_SZ", "/d", value, "/f"]))
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            receive(app, args)
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            inspect_video,
            start_download,
            cancel,
            retry,
            clear_history,
            reveal,
            defaults,
            health,
            register_extension
        ])
        .setup(|app| {
            register_app_link().map_err(std::io::Error::other)?;
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let history = dir.join("history.json");
            let mut jobs: Vec<Job> = if history.exists() {
                serde_json::from_slice(&std::fs::read(&history)?)?
            } else {
                vec![]
            };
            for j in &mut jobs {
                if ["queued", "downloading", "processing"].contains(&j.status.as_str()) {
                    j.status = "interrupted".into();
                    j.error =
                        "SmowaDL closed before this download finished. Retry to resume partial data."
                            .into();
                }
            }
            let state = Shared(Arc::new(Mutex::new(Data {
                jobs,
                processes: HashMap::new(),
                pending: vec![],
                history,
                storage_error: String::new(),
            })));
            app.manage(state.clone());
            std::thread::spawn(move || loop {
                let job = {
                    let mut d = state.0.lock().unwrap();
                    d.jobs
                        .iter_mut()
                        .rev()
                        .find(|j| j.status == "queued")
                        .map(|j| {
                            j.status = "downloading".into();
                            j.clone()
                        })
                };
                if let Some(job) = job {
                    run_job(&state, job);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
            });
            let open = MenuItem::with_id(app, "open", "Open SmowaDL", true, None::<&str>)?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                "Quit SmowaDL (stops downloads)",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let rgba = include_bytes!("../icons/tray.rgba").to_vec();
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(rgba, 32, 32))
                .tooltip("SmowaDL — running in the background")
                .menu(&menu)
                .on_menu_event(|app, e| {
                    if e.id.as_ref() == "open" {
                        show(app);
                    } else if e.id.as_ref() == "quit" {
                        let s = app.state::<Shared>();
                        let d = s.0.lock().unwrap();
                        for pid in d.processes.values() {
                            let _ = hidden(Command::new("taskkill").args([
                                "/PID",
                                &pid.to_string(),
                                "/T",
                                "/F",
                            ]))
                            .status();
                        }
                        app.exit(0);
                    }
                })
                .build(app)?;
            receive(app.handle(), std::env::args().collect());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not launch SmowaDL");
}
