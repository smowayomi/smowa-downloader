param([string]$Destination = (Join-Path $PSScriptRoot '../src-tauri/tools'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
Write-Host 'Downloading yt-dlp from its official release...'
$release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
$asset = $release.assets | Where-Object name -eq 'yt-dlp.exe' | Select-Object -First 1
$hashAsset = $release.assets | Where-Object name -eq 'SHA2-256SUMS' | Select-Object -First 1
if (!$asset -or !$hashAsset) { throw 'Official yt-dlp assets were not found.' }
$download = Join-Path $Destination 'yt-dlp.download'
Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $download
$checksums = (Invoke-WebRequest -UseBasicParsing $hashAsset.browser_download_url).Content
if ($checksums -is [byte[]]) { $checksums = [System.Text.Encoding]::UTF8.GetString($checksums) }
$match = [regex]::Match($checksums, '(?m)^([a-fA-F0-9]{64})\s+\*?yt-dlp\.exe\s*$')
if (!$match.Success -or (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'yt-dlp checksum verification failed.' }
Move-Item -LiteralPath $download -Destination (Join-Path $Destination 'yt-dlp.exe') -Force
foreach ($name in @('ffmpeg', 'ffprobe', 'node')) {
    $target = Join-Path $Destination "$name.exe"
    if (!(Test-Path -LiteralPath $target)) {
        $found = Get-Command "$name.exe" -ErrorAction SilentlyContinue
        if ($found) { Copy-Item -LiteralPath $found.Source -Destination $target }
        else { throw "$name is missing. Install FFmpeg and Node.js, then run this script again." }
    }
}
Write-Host "Tools ready. yt-dlp $($release.tag_name)"
