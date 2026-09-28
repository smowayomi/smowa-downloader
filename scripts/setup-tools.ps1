param([string]$Destination = (Join-Path $PSScriptRoot '../src-tauri/tools'), [switch]$DownloadMissing)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
Write-Host 'Downloading yt-dlp from its official release...'
$release = Invoke-RestMethod -TimeoutSec 30 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
$asset = $release.assets | Where-Object name -eq 'yt-dlp.exe' | Select-Object -First 1
$hashAsset = $release.assets | Where-Object name -eq 'SHA2-256SUMS' | Select-Object -First 1
if (!$asset -or !$hashAsset) { throw 'Official yt-dlp assets were not found.' }
$download = Join-Path $Destination 'yt-dlp.download'
$checksums = (Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing $hashAsset.browser_download_url).Content
if ($checksums -is [byte[]]) { $checksums = [System.Text.Encoding]::UTF8.GetString($checksums) }
$match = [regex]::Match($checksums, '(?m)^([a-fA-F0-9]{64})\s+\*?yt-dlp\.exe\s*$')
if (!$match.Success) { throw 'yt-dlp checksum missing' }
$ytTarget = Join-Path $Destination 'yt-dlp.exe'
if (!(Test-Path -LiteralPath $ytTarget) -or (Get-FileHash -LiteralPath $ytTarget -Algorithm SHA256).Hash -ne $match.Groups[1].Value) {
    Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing $asset.browser_download_url -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'yt-dlp checksum verification failed.' }
    Move-Item -LiteralPath $download -Destination $ytTarget -Force
}


if ($DownloadMissing) {
    $ProgressPreference = 'SilentlyContinue'
    function Get-VerifiedFile([string]$Url, [string]$Checksum, [string]$Path) {
        if ($Checksum -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid upstream checksum' }
        & curl.exe --fail --location --silent --show-error --connect-timeout 30 --max-time 600 --retry 2 --output $Path $Url
        if ($LASTEXITCODE) { throw "Download failed for $Url" }
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Checksum) { throw "Checksum failed for $Url" }
    }
    $ffUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    $checksumText = (Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing "$ffUrl.sha256").Content
    if ($checksumText -is [byte[]]) { $checksumText = [Text.Encoding]::UTF8.GetString($checksumText) }
    $checksum = [regex]::Match($checksumText, '[a-fA-F0-9]{64}').Value
    $ffMarker = Join-Path $Destination 'ffmpeg-release-checksum.txt'
    $previousChecksum = if (Test-Path $ffMarker) { (Get-Content $ffMarker -Raw).Trim() } else { '' }
    if (!(Test-Path "$Destination/ffmpeg.exe") -or !(Test-Path "$Destination/ffprobe.exe") -or $previousChecksum -ne $checksum) {
        $zip = Join-Path $Destination 'ffmpeg.zip'
        Get-VerifiedFile $ffUrl $checksum $zip
        $extract = Join-Path $Destination ('ffmpeg-' + [guid]::NewGuid())
        Expand-Archive -LiteralPath $zip -DestinationPath $extract
        foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
            $binary = Get-ChildItem -LiteralPath $extract -Filter $name -Recurse | Select-Object -First 1
            if (!$binary) { throw "Missing $name in FFmpeg package" }
            Copy-Item -LiteralPath $binary.FullName -Destination (Join-Path $Destination $name) -Force
        }
        # Retain upstream license/readme material alongside the tools.
        Get-ChildItem -LiteralPath $extract -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|README)' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination ('ffmpeg-' + $_.Name)) -Force }
        $resolvedExtract = (Resolve-Path -LiteralPath $extract).Path
        if (!$resolvedExtract.StartsWith($Destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected extraction directory' }
        Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
        Remove-Item -LiteralPath $zip -Force
        Set-Content -LiteralPath $ffMarker -Value $checksum
    }
    if (!(Test-Path "$Destination/node.exe")) {
        $base = 'https://nodejs.org/dist/latest-v24.x'
        $checks = (Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing "$base/SHASUMS256.txt").Content
        if ($checks -is [byte[]]) { $checks = [Text.Encoding]::UTF8.GetString($checks) }
        $line = [regex]::Match($checks, '(?m)^([a-fA-F0-9]{64})\s+win-x64/node.exe\s*$')
        if (!$line.Success) { throw 'Node.js checksum not found' }
        $downloadNode = Join-Path $Destination 'node.download'
        Get-VerifiedFile "$base/win-x64/node.exe" $line.Groups[1].Value $downloadNode
        Move-Item -LiteralPath $downloadNode -Destination "$Destination/node.exe" -Force
        Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing "$base/LICENSE" -OutFile "$Destination/node-LICENSE.txt"
    }
} else {
    foreach ($name in @('ffmpeg', 'ffprobe', 'node')) {
        $target = Join-Path $Destination "$name.exe"
        if (!(Test-Path -LiteralPath $target)) {
            $found = Get-Command "$name.exe" -ErrorAction SilentlyContinue
            if ($found) { Copy-Item -LiteralPath $found.Source -Destination $target }
            else { throw "$name is missing. Run this script with -DownloadMissing." }
        }
    }
}
Write-Host "Tools ready. yt-dlp $($release.tag_name)"
