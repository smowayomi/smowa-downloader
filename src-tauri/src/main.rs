#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod engine;
mod updates;
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
    #[serde(default)]
    queue_order: u64,
    #[serde(default)]
    phase: String,
    #[serde(default)]
    downloaded_bytes: u64,
    #[serde(default)]
    total_bytes: Option<u64>,
    #[serde(default)]
    total_estimated: bool,
}
#[derive(Clone)]
struct Shared(Arc<Mutex<Data>>);
struct Data {
    jobs: Vec<Job>,
    processes: HashMap<String, u32>,
    pending: Vec<String>,
    history: PathBuf,
    storage_error: String,
    installing_update: bool,
}
fn hidden(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}
fn tool(name: &str) -> PathBuf {
    if let Some(dir) = engine::TOOLS.get() {
        let managed = dir.join(format!("{name}.exe"));
        if managed.is_file() {
            return managed;
        }
    }
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
        "--encoding",
        "utf-8",
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
async fn inspect_video(url: String, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    engine::ensure_ready(&app)?;
    let url = validate_url(&url)?;
    tauri::async_runtime::spawn_blocking(move||{let out=command().args(["--dump-single-json","--skip-download","--",&url]).output().map_err(|e|format!("yt-dlp could not start. Run setup-tools.ps1. {e}"))?;if !out.status.success(){return Err(String::from_utf8_lossy(&out.stderr).chars().take(2500).collect());}let v:serde_json::Value=serde_json::from_slice(&out.stdout).map_err(|e|e.to_string())?;Ok(serde_json::json!({"title":v["title"],"thumbnail":v["thumbnail"],"duration":v["duration"],"uploader":v["uploader"],"formats":v["formats"],"audioOnly": v["vcodec"].as_str() == Some("none") || v["formats"].as_array().is_some_and(|fs| !fs.is_empty() && fs.iter().all(|f| f["vcodec"].as_str() == Some("none"))),"url":url}))}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn start_download(
    options: Options,
    title: String,
    state: State<Shared>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    download_args(&options)?;
    std::fs::create_dir_all(&options.folder).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut job = Job {
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
        queue_order: 0,
        phase: "Waiting in queue".into(),
        downloaded_bytes: 0,
        total_bytes: None,
        total_estimated: false,
    };
    let mut d = state.0.lock().unwrap();
    engine::ensure_ready(&app)?;
    if d.installing_update {
        return Err("An app update is being installed. Try again after restart.".into());
    }
    job.queue_order = next_order(&d);
    d.jobs.insert(0, job);
    save(&mut d);
    Ok(id)
}
fn byte_count(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.)
        .map(|v| v as u64)
}
fn run_job(s: &Shared, job: Job) {
    let args = match download_args(&job.options) {
        Ok(a) => a,
        Err(e) => {
            change(
                s,
                &job.id,
                |j| {
                    if ["paused", "cancelled"].contains(&j.status.as_str()) {
                        return;
                    }
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
                    if ["paused", "cancelled"].contains(&j.status.as_str()) {
                        return;
                    }
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
            .any(|j| j.id == job.id && ["cancelled", "paused"].contains(&j.status.as_str()))
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
                    if !["cancelled", "paused"].contains(&j.status.as_str()) {
                        j.percent = p;
                        j.speed = speed;
                        j.eta = eta;
                        j.status = "downloading".into();
                        let fields: Vec<_> = line.split('|').collect();
                        if fields.len() >= 8 {
                            j.downloaded_bytes = fields[3].parse().unwrap_or(0);
                            let exact = byte_count(fields[4]);
                            j.total_bytes = exact.or_else(|| byte_count(fields[5]));
                            j.total_estimated = exact.is_none();
                            j.phase = if job.options.start_time.is_some() {
                                "Downloading section"
                            } else if fields[6] == "none" {
                                "Fetching audio"
                            } else if fields[7] == "none" {
                                "Fetching video"
                            } else {
                                "Fetching media"
                            }
                            .into();
                        }
                    }
                },
                false,
            );
        } else if let Some(file) = line.strip_prefix("SMOWA_FILE:") {
            change(s, &job.id, |j| j.file = file.into(), false);
        } else if (job.options.start_time.is_some() && line.starts_with("[download] Destination:"))
            || line.starts_with("SMOWA_STAGE:")
            || line.contains("[Merger]")
            || line.contains("[ExtractAudio]")
            || line.contains("[VideoRemuxer]")
        {
            change(
                s,
                &job.id,
                |j| {
                    if !["cancelled", "paused"].contains(&j.status.as_str()) {
                        j.status = "processing".into();
                        j.speed.clear();
                        j.eta.clear();
                        j.phase = if line.starts_with("[download] Destination:") {
                            "Downloading and trimming section"
                        } else if line.contains("Merger") {
                            "Merging video and audio"
                        } else if line.contains("ExtractAudio") {
                            "Converting audio"
                        } else if job.options.start_time.is_some() {
                            "Finalizing trimmed section"
                        } else {
                            "Finalizing file"
                        }
                        .into();
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
            if ["cancelled", "paused"].contains(&j.status.as_str()) {
                return;
            }
            if result.is_ok_and(|r| r.success()) && !j.file.is_empty() {
                j.status = "completed".into();
                j.percent = 100.;
                j.speed.clear();
                j.eta.clear();
                j.phase = "Completed".into();
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
fn next_order(d: &Data) -> u64 {
    d.jobs
        .iter()
        .map(|j| {
            if j.queue_order == 0 {
                j.created
            } else {
                j.queue_order
            }
        })
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}
fn stop_job(id: &str, state: &Shared, status: &str) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    let index = d
        .jobs
        .iter()
        .position(|j| j.id == id)
        .ok_or("Download not found")?;
    if !["queued", "downloading", "processing", "paused"].contains(&d.jobs[index].status.as_str()) {
        return Ok(());
    }
    if let Some(pid) = d.processes.get(id) {
        let result = hidden(Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]))
            .status()
            .map_err(|e| e.to_string())?;
        if !result.success() {
            return Err("Could not stop the download process; please retry.".into());
        }
    }
    d.jobs[index].status = status.into();
    d.jobs[index].phase = if status == "paused" {
        "Paused; partial data kept"
    } else {
        "Cancelled"
    }
    .into();
    d.jobs[index].speed.clear();
    d.jobs[index].eta.clear();
    save(&mut d);
    Ok(())
}
#[tauri::command]
fn cancel(id: String, state: State<Shared>) -> Result<(), String> {
    stop_job(&id, &state, "cancelled")
}
#[tauri::command]
fn pause(id: String, state: State<Shared>) -> Result<(), String> {
    stop_job(&id, &state, "paused")
}
#[tauri::command]
fn reorder(id: String, direction: String, state: State<Shared>) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    reorder_jobs(&mut d.jobs, &id, &direction)?;
    save(&mut d);
    Ok(())
}
fn reorder_jobs(jobs: &mut [Job], id: &str, direction: &str) -> Result<(), String> {
    let mut order: Vec<_> = jobs
        .iter()
        .filter(|j| j.status == "queued")
        .map(|j| {
            (
                j.id.clone(),
                if j.queue_order == 0 {
                    j.created
                } else {
                    j.queue_order
                },
            )
        })
        .collect();
    order.sort_by_key(|j| j.1);
    let index = order
        .iter()
        .position(|j| j.0 == id)
        .ok_or("Only queued downloads can be reordered")?;
    let target = match direction {
        "next" => 0,
        "up" => index.saturating_sub(1),
        "down" => (index + 1).min(order.len() - 1),
        _ => return Err("Invalid queue direction".into()),
    };
    let item = order.remove(index);
    order.insert(target, item);
    for (rank, (id, _)) in order.iter().enumerate() {
        jobs.iter_mut().find(|j| &j.id == id).unwrap().queue_order = rank as u64 + 1;
    }
    Ok(())
}
#[tauri::command]
fn resume_all(state: State<Shared>, app: tauri::AppHandle) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    engine::ensure_ready(&app)?;
    if d.installing_update {
        return Err("An app update is being installed".into());
    }
    let mut order = next_order(&d);
    let stopping: Vec<_> = d.processes.keys().cloned().collect();
    for job in d.jobs.iter_mut().rev() {
        if ["paused", "interrupted"].contains(&job.status.as_str()) && !stopping.contains(&job.id) {
            job.status = "queued".into();
            job.phase = "Waiting to resume".into();
            job.error.clear();
            job.queue_order = order;
            order += 1;
        }
    }
    save(&mut d);
    Ok(())
}
#[tauri::command]
fn retry(id: String, state: State<Shared>, app: tauri::AppHandle) -> Result<(), String> {
    let mut d = state.0.lock().unwrap();
    if d.installing_update {
        return Err("An app update is being installed".into());
    }
    engine::ensure_ready(&app)?;
    if d.processes.contains_key(&id) {
        return Err("The previous process is still stopping. Try again in a moment.".into());
    }
    let order = next_order(&d);
    let j = d
        .jobs
        .iter_mut()
        .find(|j| j.id == id)
        .ok_or("Download not found")?;
    if !["failed", "cancelled", "interrupted", "paused"].contains(&j.status.as_str()) {
        return Err("Only stopped downloads can be retried".into());
    }
    j.status = "queued".into();
    j.queue_order = order;
    j.phase = "Waiting to resume".into();
    j.error.clear();
    j.percent = 0.;
    j.file.clear();
    save(&mut d);
    Ok(())
}
#[tauri::command]
fn clear_history(state: State<Shared>) {
    let mut d = state.0.lock().unwrap();
    d.jobs.retain(|j| {
        [
            "queued",
            "downloading",
            "processing",
            "paused",
            "interrupted",
        ]
        .contains(&j.status.as_str())
    });
    save(&mut d);
}
fn open_folder(folder: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let path: Vec<u16> = folder.as_os_str().encode_wide().chain(Some(0)).collect();
    // The null verb asks Windows for the user's default folder action.
    // Buffers remain alive for the call; no command-line interpolation is involved.
    let result = unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize;
        if initialized >= 0 {
            CoUninitialize();
        }
        result
    };
    if result <= 32 {
        return Err(format!(
            "Windows could not open the download folder (error {result})"
        ));
    }
    Ok(())
}
fn completed_file(id: &str, state: &Shared) -> Result<PathBuf, String> {
    let mut d = state.0.lock().unwrap();
    let job = d
        .jobs
        .iter_mut()
        .find(|j| j.id == id)
        .ok_or("Download not found")?;
    if job.status != "completed" {
        return Err("The download has not finished yet".into());
    }
    let path = smowa::resolve_downloaded_file(&job.file)?;
    if path != std::path::Path::new(&job.file) {
        job.file = path.to_string_lossy().into_owned();
        save(&mut d);
    }
    Ok(path)
}
#[tauri::command]
fn reveal(id: String, state: State<Shared>) -> Result<(), String> {
    let path = completed_file(&id, &state)?;
    open_folder(path.parent().ok_or("Download folder not found")?)
}
#[tauri::command]
async fn copy_file(id: String, state: State<'_, Shared>) -> Result<(), String> {
    let path = completed_file(&id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        // FileDrop is a file clipboard entry, not text. A separate STA process lets
        // Windows Forms persist the data after exit. The path is never shell code.
        let script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $files=New-Object System.Collections.Specialized.StringCollection; [void]$files.Add($env:SMOWADL_CLIPBOARD_FILE); [System.Windows.Forms.Clipboard]::SetFileDropList($files)";
        let output = hidden(Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
            .env("SMOWADL_CLIPBOARD_FILE", path))
            .output().map_err(|e| format!("Could not copy file: {e}"))?;
        if !output.status.success() {
            return Err("Could not access the clipboard. Please try Copy file again.".into());
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            inspect_video,
            start_download,
            cancel,
            pause, reorder, resume_all,
            retry,
            clear_history,
            reveal,
            copy_file,
            defaults,
            health,
            register_extension,
            updates::update_status,
            updates::set_auto_updates,
            updates::check_update,
            updates::install_update,
            engine::engine_status,
            engine::engine_details,
            engine::prepare_engine
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
                installing_update: false,
            })));
            app.manage(state.clone());
            engine::initialize(app.handle(), &dir);
            updates::initialize(app.handle(), &dir);
            std::thread::spawn(move || loop {
                let job = {
                    let mut d = state.0.lock().unwrap();
                    d.jobs
                        .iter_mut()
                        .filter(|j| j.status == "queued")
                        .min_by_key(|j| if j.queue_order == 0 {j.created} else {j.queue_order})
                        .map(|j| {
                            j.status = "downloading".into();
                            j.phase = "Connecting".into();
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

#[cfg(test)]
mod queue_tests {
    use super::*;
    fn job(id: &str, status: &str, created: u64) -> Job {
        serde_json::from_value(serde_json::json!({"id":id,"title":id,"url":"https://example.com/video", "status":status, "percent":0,"speed":"","eta":"","error":"","file":"","created":created,
        "options":{"url":"https://example.com/video","resolution":0,"codec":"auto","format":"mp4","quality":"best","folder":"C:/Downloads"}})).unwrap()
    }
    fn queued(jobs: &[Job]) -> Vec<&str> {
        let mut list: Vec<_> = jobs.iter().filter(|j| j.status == "queued").collect();
        list.sort_by_key(|j| {
            if j.queue_order == 0 {
                j.created
            } else {
                j.queue_order
            }
        });
        list.iter().map(|j| j.id.as_str()).collect()
    }
    #[test]
    fn queue_order_survives_storage_and_excludes_active_and_paused() {
        let mut jobs = vec![
            job("c", "queued", 30),
            job("active", "downloading", 1),
            job("b", "queued", 20),
            job("paused", "paused", 2),
            job("a", "queued", 10),
        ];
        reorder_jobs(&mut jobs, "c", "next").unwrap();
        assert_eq!(queued(&jobs), ["c", "a", "b"]);
        reorder_jobs(&mut jobs, "b", "up").unwrap();
        assert_eq!(queued(&jobs), ["c", "b", "a"]);
        reorder_jobs(&mut jobs, "c", "down").unwrap();
        let restored: Vec<Job> =
            serde_json::from_str(&serde_json::to_string(&jobs).unwrap()).unwrap();
        assert_eq!(queued(&restored), ["b", "c", "a"]);
        assert!(reorder_jobs(&mut jobs, "active", "next").is_err());
        assert!(reorder_jobs(&mut jobs, "paused", "next").is_err());
        assert!(reorder_jobs(&mut jobs, "a", "invalid").is_err());
    }
    #[test]
    fn estimated_byte_counts_accept_fractional_totals() {
        assert_eq!(byte_count("1234.5"), Some(1234));
        for input in ["NA", "NaN", "inf", "-1", "0"] {
            assert_eq!(byte_count(input), None);
        }
    }
}
