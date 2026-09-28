param([Parameter(Mandatory)][string]$Tag, [string]$Repository = 'smowayomi/smowa-downloader')
$ErrorActionPreference = 'Stop'
$version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
if ($Tag -ne "v$version") { throw 'Release tag must match the app version' }
$installer = Get-ChildItem src-tauri/target/release/bundle/nsis/*-setup.exe | Select-Object -First 1
if (!$installer -or !(Test-Path "$($installer.FullName).sig")) { throw 'Signed installer is missing' }
$out = Join-Path (Get-Location) 'release-assets'
New-Item -ItemType Directory -Force $out | Out-Null
$installerName = "SmowaDL_${version}_x64-setup.exe"
Copy-Item -LiteralPath $installer.FullName -Destination "$out/$installerName" -Force
Copy-Item -LiteralPath "$($installer.FullName).sig" -Destination "$out/$installerName.sig" -Force
$signature = (Get-Content -LiteralPath "$($installer.FullName).sig" -Raw).Trim()
@{version=$version; notes="SmowaDL $version. See GitHub release notes for details."; pub_date=[DateTime]::UtcNow.ToString('o'); platforms=@{'windows-x86_64'=@{signature=$signature; url="https://github.com/$Repository/releases/download/$Tag/$installerName"}}} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$out/latest.json"
Compress-Archive -Path extension/* -DestinationPath "$out/SmowaDL-extension.zip" -Force
Get-ChildItem $out -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object { "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" } | Set-Content "$out/SHA256SUMS.txt"
