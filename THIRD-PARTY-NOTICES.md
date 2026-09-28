# Third-party components

SmowaDL uses Tauri and plugins (MIT / Apache-2.0), Lucide (ISC), Vite (MIT), TypeScript (Apache-2.0) and dependencies recorded in the lockfiles.

Public installers do not redistribute media-engine executables. First-run setup downloads these separately, verifies upstream SHA-256 checksums and retains supplied notices where available:

- yt-dlp: https://github.com/yt-dlp/yt-dlp — Windows releases include GPLv3+ components. Sources and notices: https://github.com/yt-dlp/yt-dlp/releases
- FFmpeg / FFprobe: https://www.gyan.dev/ffmpeg/builds/ — GPLv3 essentials builds. The upstream page links sources and build information. License and README files are retained alongside the tools.
- Node.js: https://nodejs.org — MIT and third-party components; the distribution LICENSE is retained alongside node.exe.

Local portable development packaging can copy independently installed tools. Review the licenses and source requirements of those exact builds before redistributing that folder. Public releases use the installer workflow.
