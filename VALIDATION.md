# Validation — 2026-09-28

Verified on this Windows machine:

- TypeScript check and production frontend build passed.
- Rust unit tests: 4 passed (URL allowlist, constrained format selection, audio/container validation, real progress parsing).
- Clippy with warnings treated as errors passed.
- Portable release built with the embedded frontend (`custom-protocol`).
- Browser interaction checks passed: navigation, history search, preview feedback, minimum window width and no JavaScript exceptions. Screenshots were visually reviewed.
- Native WebView2 app launched successfully; bundled yt-dlp, FFmpeg and Node health checks passed.
- The actual native messaging executable rejected an unsupported URL and accepted a YouTube link, focusing the existing Smowa instance.
- Cancellation was exercised through the native backend. History entries survived app restarts, with no storage errors.
- Live YouTube metadata loaded through the app. A 19-second public video downloaded through the UI to a real MP4 file (635,505 bytes), then appeared as completed in history.

Not yet verified: loading the unpacked extension into a user's Chrome profile and clicking its toolbar button; live TikTok/Instagram extraction; restricted/private content (unsupported in this version). The protocol helper itself was exercised directly using Chrome-compatible framed messages.

Reproducible browser check: run `npm run dev`, then `node scripts/ui-check.mjs`. Native check: launch a test app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9227`, then run `node scripts/native-check.mjs`. The native check makes a real small download into `.preview/downloads` and adds a history entry. Close the test process afterwards and relaunch without that environment variable.

## Smowaudio visual alignment

The interface now uses Smowaudio's exact dark palette and native font stacks, 72 px navigation rail, compact top bar, neutral primary buttons and shared multicolor brand mark. The extension popup and Windows/tray icons follow the same styling.

`node scripts/layout-check.mjs` exercises the actual loading transition with a delayed metadata fixture, checks 16 px inner bottom padding (17 px including the border) at 1180 px and 860 px, and captures idle, loading, loaded options and helper screens for visual review. Those checks and the production frontend/native release builds passed. The test fixture does not download a video or change user history.

## Brave helper repair

Verified the user's saved ID matched the unpacked extension in Brave. A fresh isolated Brave profile could use the previous Chrome registration, so the original normal-profile failure was not reproduced. Pairing now explicitly registers Brave and Chrome in both registry views. The existing pairing was repaired without changing its ID. Popup v0.1.1 displays the exact native messaging error, specific recovery guidance and its own extension ID.

`node scripts/brave-check.mjs` passed both cold app launch and reuse of a running single instance through real Brave native messaging. The test uses an isolated Brave profile and exercises the real popup button with a selected-video-tab fixture. It does not alter the user's browser profile. The user's installed extension must be reloaded to pick up updated popup code. Production builds and Clippy passed.

## Broad yt-dlp website support

Removed the three-domain allowlist from Rust validation (shared by the app and native bridge) and the extension. HTTP(S) media URLs, including custom ports and unknown domains, now reach yt-dlp's site-specific and generic extractors. Non-web schemes and embedded credentials remain rejected. Extension version: 0.1.2.

Validation passed: Rust tests, Clippy, frontend/release builds; extension URL tests for Vimeo, Twitch, SoundCloud, Archive.org and generic links; audio-only UI fixture; real generic MP4 download through the native app (788,493 bytes); real generic MP3 metadata correctly detected as audio-only. The bundled engine lists 1,752 extractor entries, not distinct websites. Individual sites were not exhaustively tested. Support follows the installed engine, as in MeTube; DRM, authentication and playlist limitations still apply.

## Normal Brave profile confirmation

The user still encountered host-not-found after extension reload and a browser restart. Registration, nativeMessaging permission, ID and relevant policy checks were correct; isolated tests with the normal Chromium sandbox also passed. The user then fully exited Brave, and the same executable was launched with session restore and local diagnostic logging. The user confirmed Smowa opened successfully from the actual extension in their normal profile. The precise cause of the earlier discrepancy is not established; no browser security or policy settings were changed.
