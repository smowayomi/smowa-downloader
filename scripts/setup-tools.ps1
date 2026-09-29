param([string]$Destination = (Join-Path $PSScriptRoot '../src-tauri/tools'), [switch]$DownloadMissing)
$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
function Report-Tool([string]$Name, [string]$Stage) { Write-Output "SMOWA_TOOL:$Name|$Stage" }
Report-Tool 'yt-dlp' 'Checking release'
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
if (!(Test-Path -LiteralPath $ytTarget) -or (Get-Sha256 $ytTarget) -ne $match.Groups[1].Value) {
    Report-Tool 'yt-dlp' 'Downloading'
    Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing $asset.browser_download_url -OutFile $download
    if ((Get-Sha256 $download) -ne $match.Groups[1].Value) { throw 'yt-dlp checksum verification failed.' }
    Move-Item -LiteralPath $download -Destination $ytTarget -Force
}


Report-Tool 'yt-dlp' 'Ready'
if ($DownloadMissing) {
    $ProgressPreference = 'SilentlyContinue'
    function Get-VerifiedFile([string]$Url, [string]$Checksum, [string]$Path) {
        if ($Checksum -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid upstream checksum' }
        & curl.exe --fail --location --silent --show-error --connect-timeout 30 --max-time 600 --retry 2 --output $Path $Url
        if ($LASTEXITCODE) { throw "Download failed for $Url" }
        if ((Get-Sha256 $Path) -ne $Checksum) { throw "Checksum failed for $Url" }
    }
    Report-Tool 'FFmpeg' 'Checking release'
    $ffRelease = Invoke-RestMethod -TimeoutSec 30 'https://api.github.com/repos/GyanD/codexffmpeg/releases/latest'
    $ffAsset = $ffRelease.assets | Where-Object name -Like '*-essentials_build.7z' | Select-Object -First 1
    if (!$ffAsset -or $ffAsset.digest -notmatch '^sha256:([a-fA-F0-9]{64})$') { throw 'FFmpeg release checksum not found' }
    $ffUrl = $ffAsset.browser_download_url
    $checksum = $Matches[1]
    $ffMarker = Join-Path $Destination 'ffmpeg-release-checksum.txt'
    $previousChecksum = if (Test-Path $ffMarker) { (Get-Content $ffMarker -Raw).Trim() } else { '' }
    if (!(Test-Path "$Destination/ffmpeg.exe") -or !(Test-Path "$Destination/ffprobe.exe") -or $previousChecksum -ne $checksum) {
        $zip = Join-Path $Destination 'ffmpeg.7z'
        Report-Tool 'FFmpeg' 'Downloading'
        Get-VerifiedFile $ffUrl $checksum $zip
        $extract = Join-Path $Destination ('ffmpeg-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force $extract | Out-Null
        Report-Tool 'FFmpeg' 'Verifying and extracting'
        & tar.exe -xf $zip -C $extract
        if ($LASTEXITCODE) { throw "FFmpeg extraction failed" }
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
    Report-Tool 'FFmpeg' 'Ready'
    Report-Tool 'Node.js' 'Checking installation'
    if (!(Test-Path "$Destination/node.exe")) {
        $base = 'https://nodejs.org/dist/latest-v24.x'
        $checks = (Invoke-WebRequest -TimeoutSec 120 -UseBasicParsing "$base/SHASUMS256.txt").Content
        if ($checks -is [byte[]]) { $checks = [Text.Encoding]::UTF8.GetString($checks) }
        $line = [regex]::Match($checks, '(?m)^([a-fA-F0-9]{64})\s+(node-v24\.[0-9.]+-win-x64.zip)\s*$')
        if (!$line.Success) { throw 'Node.js checksum not found' }
        $archive = Join-Path $Destination 'node.zip'
        $nodeVersion = $line.Groups[2].Value -replace '^node-(v[0-9.]+)-win-x64.zip$', '$1'
        Report-Tool 'Node.js' 'Downloading'
        Get-VerifiedFile "https://nodejs.org/dist/$nodeVersion/$($line.Groups[2].Value)" $line.Groups[1].Value $archive
        $nodeExtract = Join-Path $Destination ('node-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force $nodeExtract | Out-Null
        Report-Tool 'Node.js' 'Verifying and extracting'
        & tar.exe -xf $archive -C $nodeExtract
        if ($LASTEXITCODE) { throw 'Node.js extraction failed' }
        $nodeRoot = Get-ChildItem -LiteralPath $nodeExtract -Directory | Select-Object -First 1
        if (!$nodeRoot -or !(Test-Path "$($nodeRoot.FullName)/node.exe")) { throw 'Node.js executable missing from package' }
        Copy-Item -LiteralPath "$($nodeRoot.FullName)/node.exe" -Destination "$Destination/node.exe" -Force
        Copy-Item -LiteralPath "$($nodeRoot.FullName)/LICENSE" -Destination "$Destination/node-LICENSE.txt" -Force
        $resolvedNode = (Resolve-Path -LiteralPath $nodeExtract).Path
        if (!$resolvedNode.StartsWith($Destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected extraction directory' }
        Remove-Item -LiteralPath $resolvedNode -Recurse -Force
        Remove-Item -LiteralPath $archive -Force

    }
    Report-Tool 'Node.js' 'Ready'
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
