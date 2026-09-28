param([switch]$SkipBridge)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $resources = Join-Path (Get-Location) 'src-tauri/resources'
    New-Item -ItemType Directory -Force "$resources/extension", "$resources/scripts" | Out-Null
    Copy-Item extension/* "$resources/extension" -Recurse -Force
    Copy-Item scripts/setup-tools.ps1 "$resources/scripts" -Force
    if (!$SkipBridge) {
        cargo build --locked --release --manifest-path src-tauri/Cargo.toml --bin smowa-bridge
        if ($LASTEXITCODE) { throw 'Bridge build failed' }
    }
    Copy-Item src-tauri/target/release/smowa-bridge.exe "$resources/smowa-bridge.exe" -Force
    Copy-Item README.md,THIRD-PARTY-NOTICES.md $resources -Force
} finally { Pop-Location }
