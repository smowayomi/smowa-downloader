#![cfg_attr(not(debug_assertions), windows_subsystem = "console")]
use std::io::{Read, Write};
fn main() {
    let result = handle();
    let msg = match result {
        Ok(()) => serde_json::json!({"ok":true}),
        Err(e) => serde_json::json!({"ok":false,"error":e}),
    };
    let bytes = serde_json::to_vec(&msg).unwrap();
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(&(bytes.len() as u32).to_le_bytes());
    let _ = stdout.write_all(&bytes);
    let _ = stdout.flush();
}
fn handle() -> Result<(), String> {
    let mut input = std::io::stdin().lock();
    let mut size = [0u8; 4];
    input.read_exact(&mut size).map_err(|e| e.to_string())?;
    let size = u32::from_le_bytes(size) as usize;
    if size > 65536 {
        return Err("Message too large".into());
    }
    let mut bytes = vec![0; size];
    input.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let url = smowa::validate_url(value["url"].as_str().unwrap_or(""))?;
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("smowa.exe");
    std::process::Command::new(exe)
        .args(["--url", &url])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
