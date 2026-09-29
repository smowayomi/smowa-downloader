# Fragment concurrency benchmark

A 90-second public X video was downloaded with yt-dlp using the same cached metadata, format `hls-972` (810p), output disk, and network connection. Each run used a fresh output filename. Runs were sequential, in order 1, 4, 8, 8, 4, 1 to reduce ordering bias. Times include yt-dlp startup and output finalization, but exclude metadata extraction.

| Parallel fragments | Run 1 | Run 2 | Mean |
|---|---:|---:|---:|
| 1 | 9.07 s | 9.87 s | 9.47 s |
| 4 | 5.79 s | 6.25 s | 6.02 s |
| 8 | 5.02 s | 4.92 s | 4.97 s |

All six files were 9,507,054 bytes with SHA-256 `0cea0d13360f376932b7d0e08223b4a6fcec9303bf818d27de81b1136839d1c2`.

Eight fragments reduced total elapsed time by about 48% in this test. This is a small benchmark of one source; it does not establish maximum bandwidth or predict every website. CDN caching, request limits, network congestion, source formats, and file sizes affect results. Direct HTTP files and section downloads handled by FFmpeg do not use yt-dlp's native parallel-fragment path.

SmowaDL defaults to eight fragments, exposes four and one as alternatives, validates the setting in Rust, and stores it with each new download. No network speed cap is configured. The global queue still processes one download at a time.
