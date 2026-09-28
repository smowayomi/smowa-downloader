# Smowa

A Windows video downloader with a Rust/Tauri desktop app and a Chrome helper. Paste a YouTube, TikTok or Instagram link, inspect the video, choose your settings and download. Inspired by MeTube's simple workflow.

## Run

Open `release/Smowa/smowa.exe`. Keep the complete folder together, including `tools`, `extension`, and `smowa-bridge.exe`. Windows WebView2 is required (included on modern Windows 11 installations).

Closing the window hides Smowa in the system tray. Right-click its tray icon to open it or quit. Downloads continue while the window is hidden. Quitting stops running downloads. After an unexpected shutdown, interrupted jobs can be retried to resume partial downloads. Windows login autostart is not enabled.

## Connect Chrome (one time)

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `release/Smowa/extension`.
3. Copy the extension ID, open **Browser helper** in Smowa, paste it and click **Connect helper**.
4. Pin the extension. On a video page, click Smowa to open the app with that video's options.

Pairing registers a native messaging host for the current Windows user only. No administrator rights, listening web server or all-sites permission is needed. Moving the app folder requires pairing again. To unregister, remove `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.smowa.downloader` and remove the extension in Chrome.

## Features and behavior

- Resolution ceiling, source codec selection (H.264 / VP9 / AV1 where available), quality preference, MP4 / MKV / WebM video, MP3 / M4A audio, folder picker.
- One download at a time with an ordered queue, progress, speed, ETA, cancellation, retries and Explorer reveal.
- Searchable persistent history in `%APPDATA%\com.smowa.downloader\history.json`. Clearing history keeps downloaded files.
- Resolution and codec controls reflect available source metadata. A chosen codec is a constraint, not a transcoding request. If a container/stream combination cannot be muxed, use MKV or another codec.
- Best/balanced/smaller select source streams. Balanced favors 30 fps; smaller favors lower bitrate within a resolution. These may produce the same result when there is only one matching stream. Audio quality controls conversion quality.
- Progress is per source stream and may reset between video and audio. Merging and audio conversion are shown as processing.
- URLs and downloads are handled locally by yt-dlp. The original websites still receive network requests.

## Development

Requires Windows, Rust MSVC, Visual Studio C++ build tools, Node.js, WebView2 and FFmpeg on PATH.

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/setup-tools.ps1
npm run tauri dev
```

Build the portable release with `powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1`. This includes the native messaging bridge and copies local FFmpeg, FFprobe and Node runtimes. `setup-tools.ps1` downloads yt-dlp from its official GitHub release and verifies SHA-256 against the release checksum file.

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Current limits

Single videos only, no playlist handling, browser cookie import, login flow or DRM support. Private, age-restricted, login-required or anti-bot-protected videos may fail. Site compatibility follows yt-dlp and can change. Close Smowa and run **Update tools.cmd** if a supported site stops working. Only download videos you have permission to save.

## Architecture

`src/` contains the TypeScript interface. `src-tauri/src/main.rs` owns the queue, process lifecycle, persistence, tray and desktop commands. `src-tauri/src/lib.rs` contains URL validation, download argument construction and progress parsing. `src-tauri/src/bin/bridge.rs` implements Chrome's length-prefixed native messaging protocol and starts the single-instance app. The bridge has no shell command interpolation; URLs are allowlisted and passed as individual arguments.

References: [Tauri](https://v2.tauri.app/), [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [yt-dlp](https://github.com/yt-dlp/yt-dlp).
