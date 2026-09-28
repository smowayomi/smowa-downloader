# Third-party components

This local development build uses Tauri (MIT / Apache-2.0), Lucide (ISC), Vite (MIT), TypeScript (Apache-2.0), and their dependencies. Refer to the lockfiles and upstream repositories for exact versions and full notices.

The portable folder may include these independently licensed executables:

- yt-dlp Windows executable: https://github.com/yt-dlp/yt-dlp — Windows release includes GPLv3+ components. Release and source: https://github.com/yt-dlp/yt-dlp/releases
- FFmpeg / FFprobe: https://ffmpeg.org/legal.html — licensing depends on the installed build configuration. Run `tools/ffmpeg.exe -L` and `-buildconf` to inspect this build. Obtain corresponding source and comply with the build's license before redistributing.
- Node.js: https://github.com/nodejs/node/blob/main/LICENSE — MIT and third-party components. Sources: https://nodejs.org/en/download

This folder is prepared for local use. Review and include all required license texts and corresponding source offers before public redistribution.
