use serde::{Deserialize, Serialize};

pub fn validate_url(raw: &str) -> Result<String, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "Enter a valid video URL".to_string())?;
    if !["http", "https"].contains(&u.scheme())
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Use an HTTP or HTTPS media link without embedded login credentials".into());
    }
    Ok(u.into())
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Options {
    pub url: String,
    pub resolution: u32,
    pub codec: String,
    pub format: String,
    pub quality: String,
    pub folder: String,
    #[serde(default = "default_fragment_concurrency")]
    pub fragment_concurrency: u8,
    #[serde(default)]
    pub start_time: Option<f64>,
    #[serde(default)]
    pub end_time: Option<f64>,
}

fn default_fragment_concurrency() -> u8 {
    8
}

pub fn download_args(o: &Options) -> Result<Vec<String>, String> {
    validate_url(&o.url)?;
    if ![1, 4, 8].contains(&o.fragment_concurrency) {
        return Err("Invalid parallel download setting".into());
    }
    if ![0, 360, 480, 720, 1080, 1440, 2160, 4320].contains(&o.resolution) {
        return Err("Invalid resolution".into());
    }
    if !["auto", "h264", "vp9", "av1"].contains(&o.codec.as_str())
        || !["mp4", "mkv", "webm", "mp3", "m4a"].contains(&o.format.as_str())
        || !(["best", "balanced", "small"].contains(&o.quality.as_str())
            || (["mp3", "m4a"].contains(&o.format.as_str())
                && ["128K", "192K", "256K", "320K"].contains(&o.quality.as_str())))
    {
        return Err("Invalid download options".into());
    }
    if o.folder.trim().is_empty() || !std::path::Path::new(&o.folder).is_absolute() {
        return Err("Choose an absolute download folder".into());
    }
    let mut args: Vec<String> = vec!["--newline","--progress","--no-colors","--windows-filenames","--no-overwrites","--progress-delta","0.5","--progress-template","download:SMOWA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(info.vcodec)s|%(info.acodec)s","--print","after_move:SMOWA_FILE:%(filepath)s","-o","%(title).160B [%(id)s] [%(format_id)s].%(ext)s","-P", &o.folder].into_iter().map(String::from).collect();
    args.extend([
        "--no-quiet".into(),
        "--progress-template".into(),
        "postprocess:SMOWA_STAGE:%(progress.postprocessor)s".into(),
    ]);
    args.extend([
        "--concurrent-fragments".into(),
        o.fragment_concurrency.to_string(),
    ]);
    match (o.start_time, o.end_time) {
        (None, None) => {}
        (Some(start), Some(end))
            if start.is_finite() && end.is_finite() && start >= 0.0 && end > start =>
        {
            args.extend([
                "--download-sections".into(),
                format!("*{start}-{end}"),
                "--force-keyframes-at-cuts".into(),
            ]);
            let output = args.iter().position(|a| a == "-o").unwrap() + 1;
            args[output] =
                format!("%(title).140B [%(id)s] [%(format_id)s] [clip {start}-{end}].%(ext)s");
        }
        _ => return Err("Enter a valid start and end time; end must be after start".into()),
    }
    if ["mp3", "m4a"].contains(&o.format.as_str()) {
        args.extend([
            "-f".into(),
            "bestaudio/best".into(),
            "-x".into(),
            "--audio-format".into(),
            o.format.clone(),
            "--audio-quality".into(),
            match o.quality.as_str() {
                "128K" | "192K" | "256K" | "320K" => o.quality.as_str(),
                "balanced" => "5",
                "small" => "9",
                _ => "0",
            }
            .into(),
        ]);
    } else {
        if o.format == "webm" && o.codec == "h264" {
            return Err("H.264 is not compatible with WebM; choose MP4 or MKV".into());
        }
        let mut filter = String::new();
        if o.resolution > 0 {
            filter.push_str(&format!("[height<=?{}]", o.resolution));
        }
        match o.codec.as_str() {
            "h264" => filter.push_str("[vcodec^=avc]"),
            "vp9" => filter.push_str("[vcodec^=vp9]"),
            "av1" => filter.push_str("[vcodec^=av01]"),
            _ => {}
        }
        if o.format == "webm" {
            filter.push_str("[ext=webm]");
        }
        let audio = match o.format.as_str() {
            "mp4" => "bestaudio[ext=m4a]/bestaudio",
            "webm" => "bestaudio[ext=webm]",
            _ => "bestaudio",
        };
        let selector = format!("bestvideo{filter}+({audio})/best{filter}");
        args.extend([
            "-f".into(),
            selector,
            "--merge-output-format".into(),
            o.format.clone(),
            "--remux-video".into(),
            o.format.clone(),
        ]);
        // Quality preferences rank streams within the chosen resolution ceiling, without transcoding.
        let sort = match o.quality.as_str() {
            "small" => "res,+br,+size",
            "balanced" => "res,fps:30,br",
            _ => "res,fps,br",
        };
        args.extend(["-S".into(), sort.into()]);
    }
    args.extend(["--".into(), o.url.clone()]);
    Ok(args)
}

pub fn progress(line: &str) -> Option<(f64, String, String)> {
    let parts: Vec<_> = line.strip_prefix("SMOWA_PROGRESS:")?.split('|').collect();
    if parts.len() < 3 {
        return None;
    }
    let p = if parts[0].trim() == "NA" && parts.len() >= 8 {
        0.
    } else {
        parts[0].trim().trim_end_matches('%').parse::<f64>().ok()?
    };
    if !p.is_finite() {
        return None;
    }
    Some((
        p.clamp(0.0, 100.0),
        parts[1].trim().into(),
        parts[2].trim().into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options() -> Options {
        Options {
            url: "https://youtube.com/watch?v=test".into(),
            resolution: 1080,
            codec: "h264".into(),
            format: "mp4".into(),
            quality: "best".into(),
            folder: std::env::temp_dir().to_string_lossy().into(),
            fragment_concurrency: 8,
            start_time: None,
            end_time: None,
        }
    }
    #[test]
    fn validates_web_urls_without_a_site_allowlist() {
        for u in [
            "file:///x",
            "javascript:alert(1)",
            "ftp://example.org/a",
            "data:text/plain,test",
            "https://user:pass@example.org/a",
            "--exec calc.exe",
        ] {
            assert!(validate_url(u).is_err(), "{u}");
        }
        for u in [
            "https://vimeo.com/123",
            "https://www.twitch.tv/videos/123",
            "https://soundcloud.com/artist/track",
            "https://archive.org/details/test",
            "https://www.dailymotion.com/video/test",
            "https://www.reddit.com/r/videos/comments/test",
            "https://x.com/test/status/1",
            "http://example.org:8080/video.mp4",
            "https://example.org/embed",
        ] {
            assert!(validate_url(u).is_ok(), "{u}");
        }
    }
    #[test]
    fn preserves_constraints() {
        let a = download_args(&options()).unwrap();
        assert!(a
            .iter()
            .any(|s| s.contains("bestvideo[height<=?1080][vcodec^=avc]")));
        assert_eq!(a[a.len() - 2], "--");
    }
    #[test]
    fn audio_conversion_and_container_validation() {
        let mut o = options();
        o.format = "webm".into();
        assert!(download_args(&o).is_err());
        o.format = "mp3".into();
        assert!(download_args(&o).unwrap().contains(&"-x".into()));
    }
    #[test]
    fn bitrate_options_are_audio_only() {
        let mut o = options();
        o.quality = "192K".into();
        assert!(download_args(&o).is_err());
        o.format = "mp3".into();
        let args = download_args(&o).unwrap();
        let i = args.iter().position(|v| v == "--audio-quality").unwrap();
        assert_eq!(args[i + 1], "192K");
        o.quality = "--exec".into();
        assert!(download_args(&o).is_err());
    }
    #[test]
    fn section_downloads_are_validated_and_have_distinct_filenames() {
        let mut o = options();
        assert!(!download_args(&o)
            .unwrap()
            .iter()
            .any(|a| a == "--download-sections"));
        o.start_time = Some(12.5);
        o.end_time = Some(30.0);
        let args = download_args(&o).unwrap();
        assert!(args.iter().any(|a| a == "*12.5-30"));
        assert!(args.iter().any(|a| a.contains("[clip 12.5-30]")));
        for (start, end) in [
            (Some(-1.0), Some(10.0)),
            (Some(10.0), Some(10.0)),
            (Some(f64::NAN), Some(20.0)),
            (Some(0.0), None),
            (None, Some(20.0)),
        ] {
            o.start_time = start;
            o.end_time = end;
            assert!(download_args(&o).is_err());
        }
        let legacy = serde_json::json!({"url":"https://example.com","resolution":0,"codec":"auto","format":"mp4","quality":"best","folder":"C:/Downloads"});
        assert!(serde_json::from_value::<Options>(legacy)
            .unwrap()
            .start_time
            .is_none());
    }
    #[test]
    fn parses_real_progress() {
        assert_eq!(
            progress("SMOWA_PROGRESS: 42.5%| 2MiB/s|00:14").unwrap().0,
            42.5
        );
        assert!(progress("SMOWA_PROGRESS:NA|NA|NA").is_none());
        assert!(progress("SMOWA_PROGRESS:NaN|x|y").is_none());
        assert_eq!(
            progress("SMOWA_PROGRESS:NA|NA|NA|1024|NA|NA|avc1|none")
                .unwrap()
                .0,
            0.
        );
        assert_eq!(
            progress("SMOWA_PROGRESS:25%|1MiB/s|00:03|1024|4096|NA|none|aac")
                .unwrap()
                .0,
            25.
        );
    }
}

/// Decode only our explicit download route; never accept executable arguments.
pub fn parse_app_link(raw: &str) -> Result<String, String> {
    let u = url::Url::parse(raw).map_err(|_| "Invalid app link")?;
    if u.scheme() != "smowadl"
        || u.host_str() != Some("download")
        || !["", "/"].contains(&u.path())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || u.fragment().is_some()
    {
        return Err("Invalid app link".into());
    }
    let pairs: Vec<_> = u.query_pairs().collect();
    if pairs.len() != 1 || pairs[0].0 != "url" {
        return Err("Invalid app link parameters".into());
    }
    validate_url(&pairs[0].1)
}
#[test]
fn app_links_validate_and_preserve_media_urls() {
    assert_eq!(
        parse_app_link("smowadl://download?url=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1%26t%3D2")
            .unwrap(),
        "https://example.com/watch?v=1&t=2"
    );
    for bad in [
        "smowadl://download?url=file%3A%2F%2Fc%3A%2Ftest",
        "smowadl://other?url=https://example.com",
        "smowadl://download?url=https://example.com&url=https://other.com",
        "smowadl://download?url=https://user:pass@example.com",
        "smowadl://download?url=https://example.com&args=--exec",
    ] {
        assert!(parse_app_link(bad).is_err(), "{bad}");
    }
}

/// Older Windows pipe output dropped non-ASCII characters. Recover only one
/// exact ASCII-projected filename in the original directory; never guess by title.
pub fn resolve_downloaded_file(stored: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(stored);
    if path.is_file() {
        return Ok(path);
    }
    let missing = "The downloaded file is no longer at its original location";
    let name = path.file_name().and_then(|n| n.to_str()).ok_or(missing)?;
    let ascii = |s: &str| s.chars().filter(char::is_ascii).collect::<String>();
    let expected = ascii(name);
    let mut matches = std::fs::read_dir(path.parent().ok_or(missing)?)
        .map_err(|_| missing)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|n| ascii(n) == expected)
        });
    let found = matches.next().ok_or(missing)?.path();
    if matches.next().is_some() {
        return Err(
            "More than one file matches this history entry. Open the download folder manually."
                .into(),
        );
    }
    Ok(found)
}
#[test]
fn recovers_unicode_paths_without_guessing_ambiguous_names() {
    let dir = std::env::temp_dir().join(format!("smowa-path-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let unicode = dir.join("Video \u{1f62d} [123].mp4");
    std::fs::write(&unicode, b"test").unwrap();
    let stored = dir.join("Video  [123].mp4");
    assert_eq!(
        resolve_downloaded_file(stored.to_str().unwrap()).unwrap(),
        unicode
    );
    let other = dir.join("Video \u{1f600} [123].mp4");
    std::fs::write(&other, b"test").unwrap();
    assert!(resolve_downloaded_file(stored.to_str().unwrap()).is_err());
    assert!(resolve_downloaded_file(dir.join("Missing.mp4").to_str().unwrap()).is_err());
    std::fs::remove_file(unicode).unwrap();
    std::fs::remove_file(other).unwrap();
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn validates_parallel_downloads_and_defaults_legacy_jobs() {
    let legacy = serde_json::json!({"url":"https://example.com/video","resolution":0,"codec":"auto","format":"mp4","quality":"best","folder":std::env::temp_dir()});
    let mut options: Options = serde_json::from_value(legacy).unwrap();
    assert_eq!(options.fragment_concurrency, 8);
    for threads in [1, 4, 8] {
        options.fragment_concurrency = threads;
        let args = download_args(&options).unwrap();
        let index = args
            .iter()
            .position(|a| a == "--concurrent-fragments")
            .unwrap();
        assert_eq!(args[index + 1], threads.to_string());
    }
    for threads in [0, 2, 16, 255] {
        options.fragment_concurrency = threads;
        assert!(download_args(&options).is_err());
    }
}
