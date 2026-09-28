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
