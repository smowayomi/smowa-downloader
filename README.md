# SmowaDL

A Windows video downloader with a Rust/Tauri desktop app and a Brave/Chrome helper. Paste an HTTP(S) video or audio link from any yt-dlp-supported website, inspect the video, choose your settings and download. Inspired by MeTube's simple workflow.

## Run

Open `release/Smowa/SmowaDL.exe`. Keep the complete folder together, including `tools`, `extension`, and `smowa-bridge.exe`. Windows WebView2 is required (included on modern Windows 11 installations).

Closing the window hides Smowa in the system tray. Right-click its tray icon to open it or quit. Downloads continue while the window is hidden. Quitting stops running downloads. After an unexpected shutdown, interrupted jobs can be retried to resume partial downloads. Windows login autostart is not enabled.

## Connect Brave or Chrome (one time)

1. Go to `brave://extensions` (or `chrome://extensions` in Chrome) and enable **Developer mode**.
2. Choose **Load unpacked** and select `release/Smowa/extension`.
3. Run **SmowaDL.exe** once to register its Windows app link.
4. After an update, click **Reload** on the extension card and refresh open media pages. Click **Open in SmowaDL** in the popup, or the small download arrow on supported media. Allow Brave to open SmowaDL if prompted.

The extension uses `smowadl://` Windows app links, independent of native messaging host lookup. The app validates the enclosed HTTP(S) URL and opens download options; it does not download automatically. Run the app again if you move its folder. The installed extension folder remains `release/Smowa/extension` to preserve its ID. Legacy native messaging pairing remains available for older extensions.

Small media buttons are provided on recognizable YouTube, Instagram, X/Twitter and TikTok video containers. Ambiguous feed items are skipped; the toolbar popup remains available. Site layouts can change. Controls are keyboard accessible and hidden in fullscreen.

To remove the app-link registration, remove `HKCU\Software\Classes\smowadl`. Older native registrations may also be removed from the Brave and Chrome `NativeMessagingHosts\com.smowa.downloader` keys.

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

`src/` contains the TypeScript interface. `src-tauri/src/main.rs` owns the queue, process lifecycle, persistence, tray and desktop commands. `src-tauri/src/lib.rs` contains URL validation, download argument construction and progress parsing. `src-tauri/src/bin/bridge.rs` implements Chrome's length-prefixed native messaging protocol and starts the single-instance app. The bridge has no shell command interpolation; URLs are restricted to HTTP(S) without embedded credentials and passed as individual arguments.

References: [Tauri](https://v2.tauri.app/), [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Supported websites

Like [MeTube](https://github.com/alexta69/metube), Smowa uses [yt-dlp's supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), rather than maintaining a separate website list. Examples include YouTube, Vimeo, Twitch, TikTok, Instagram, X/Twitter, Reddit, Dailymotion, Facebook, SoundCloud, Bandcamp and Internet Archive. Generic embedded media and direct HTTP(S) media links are attempted too. The app, native bridge and Brave/Chrome extension all accept these links without domain restrictions. Audio-only metadata selects an audio output format automatically.

Actual availability follows the bundled yt-dlp version; a listed site is not a guarantee that every URL works. Login-required content, site restrictions, DRM and broken extractors remain limitations. Single-item downloads are supported; playlists and cookie import remain outside this version. Run Update tools.cmd to update yt-dlp.

### Browser connection troubleshooting

Version 0.2.0 of the extension no longer uses native messaging for downloads. If you still see “Specified native messaging host not found”, reload the extension at `brave://extensions`: that message comes from the older popup. Confirm the extension version is 0.2.0. Open SmowaDL.exe once, click the popup link, and accept Brave's external-app prompt. No extension ID pairing is needed for the new handoff.

The previous native messaging failure was reproducible in the normal Brave profile but not isolated tests. Its underlying cause is unresolved; app links avoid that lookup entirely.
