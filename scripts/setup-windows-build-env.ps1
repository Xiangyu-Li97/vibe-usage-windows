# One-shot Windows build environment setup (winget based, adapted from ATM).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-windows-build-env.ps1

$ErrorActionPreference = "Stop"

function Ensure-Tool($name, $wingetId, $check) {
    if (Get-Command $check -ErrorAction SilentlyContinue) {
        Write-Host "✓ $name already installed" -ForegroundColor Green
        return
    }
    Write-Host "Installing $name..." -ForegroundColor Cyan
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
}

Ensure-Tool "Node.js LTS" "OpenJS.NodeJS.LTS" "node"
Ensure-Tool "Rustup" "Rustlang.Rustup" "rustup"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$vcTools = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
} else {
    $null
}
if (-not $vcTools) {
    Write-Host "Installing Visual C++ Build Tools and Windows SDK..." -ForegroundColor Cyan
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --force `
        --accept-source-agreements --accept-package-agreements `
        --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
} else {
    Write-Host "✓ Visual C++ Build Tools already installed" -ForegroundColor Green
}

# Refresh the common per-user locations so a first run can finish setup in the
# same PowerShell process after winget installs Node or Rustup.
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:ProgramFiles\nodejs;$env:APPDATA\npm;$env:Path"

rustup toolchain install 1.88.0 --profile minimal
npm install -g pnpm@10

Write-Host "`nEnvironment ready. Run:" -ForegroundColor Green
Write-Host "  pnpm install"
Write-Host "  pnpm run release:windows"
Write-Host "  pnpm run release:windows:test  # external-test installer with diagnostics"
