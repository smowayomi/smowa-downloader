$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm.cmd ci
    if ($LASTEXITCODE) { throw 'Dependency installation failed' }
    npm.cmd run build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
    cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bins
    if ($LASTEXITCODE) { throw 'Rust build failed' }
    & "$PSScriptRoot/setup-tools.ps1"
    $out = Join-Path (Get-Location) 'release/Smowa'
    New-Item -ItemType Directory -Force "$out/tools", "$out/extension", "$out/scripts" | Out-Null
    Copy-Item src-tauri/target/release/smowa.exe,src-tauri/target/release/smowa-bridge.exe $out
    Copy-Item src-tauri/tools/*.exe "$out/tools"
    Copy-Item extension/* "$out/extension" -Recurse -Force
    Copy-Item scripts/setup-tools.ps1 "$out/scripts"
    Copy-Item README.md,THIRD-PARTY-NOTICES.md $out
    Set-Content -LiteralPath "$out/Update tools.cmd" -Value '@powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-tools.ps1" -Destination "%~dp0tools"'
    Write-Host "Ready: $out/Smowa.exe"
} finally { Pop-Location }
