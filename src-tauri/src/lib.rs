use serde::{Deserialize, Serialize};

pub fn validate_url(raw: &str) -> Result<String, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "Enter a valid video URL".to_string())?;
    let host = u.host_str().unwrap_or("");
    if u.scheme() != "https"
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || !["youtube.com", "youtu.be", "tiktok.com", "instagram.com"]
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
    {
        return Err("Use an HTTPS YouTube, TikTok or Instagram link".into());
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
}

pub fn download_args(o: &Options) -> Result<Vec<String>, String> {
    validate_url(&o.url)?;
    if ![0, 360, 480, 720, 1080, 1440, 2160, 4320].contains(&o.resolution) {
        return Err("Invalid resolution".into());
    }
    if !["auto", "h264", "vp9", "av1"].contains(&o.codec.as_str())
        || !["mp4", "mkv", "webm", "mp3", "m4a"].contains(&o.format.as_str())
        || !["best", "balanced", "small"].contains(&o.quality.as_str())
    {
        return Err("Invalid download options".into());
    }
    if o.folder.trim().is_empty() || !std::path::Path::new(&o.folder).is_absolute() {
        return Err("Choose an absolute download folder".into());
    }
    let mut args: Vec<String> = vec!["--newline","--progress","--no-colors","--windows-filenames","--no-overwrites","--progress-delta","0.5","--progress-template","download:SMOWA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s","--print","after_move:SMOWA_FILE:%(filepath)s","-o","%(title).160B [%(id)s] [%(format_id)s].%(ext)s","-P", &o.folder].into_iter().map(String::from).collect();
    if ["mp3", "m4a"].contains(&o.format.as_str()) {
        args.extend([
            "-f".into(),
            "bestaudio/best".into(),
            "-x".into(),
            "--audio-format".into(),
            o.format.clone(),
            "--audio-quality".into(),
            match o.quality.as_str() {
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
    if parts.len() != 3 {
        return None;
    }
    let p = parts[0].trim().trim_end_matches('%').parse::<f64>().ok()?;
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
        }
    }
    #[test]
    fn rejects_untrusted_urls() {
        for u in [
            "file:///x",
            "https://youtube.com.evil.org/a",
            "https://evil.org/?youtube.com",
            "http://youtube.com/a",
            "https://user@youtube.com/a",
            "https://youtube.com:444/a",
        ] {
            assert!(validate_url(u).is_err(), "{u}");
        }
        assert!(validate_url("https://www.youtube.com/watch?v=x").is_ok());
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
    fn parses_real_progress() {
        assert_eq!(
            progress("SMOWA_PROGRESS: 42.5%| 2MiB/s|00:14").unwrap().0,
            42.5
        );
        assert!(progress("SMOWA_PROGRESS:NA|NA|NA").is_none());
        assert!(progress("SMOWA_PROGRESS:NaN|x|y").is_none());
    }
}
