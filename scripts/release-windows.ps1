# Local Windows release build (mirror of the GitHub Actions release job).
# Prereqs: Node 22+, pnpm 10, Rust 1.88 (rustup), NSIS (bundled with tauri-cli).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1

param(
  [switch]$ExternalTest
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if ($ExternalTest) {
  $env:TAURI_FEATURES = "external-test-diagnostics"
  $env:VIBE_USAGE_BUILD_KIND = "external-test"
  $env:VIBE_USAGE_APP_BUILD = "local-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  if (-not $env:VIBE_USAGE_APP_COMMIT) {
    $commit = if (Get-Command git -ErrorAction SilentlyContinue) {
      (& git rev-parse --short=12 HEAD 2>$null)
    } else {
      $null
    }
    $env:VIBE_USAGE_APP_COMMIT = if ($LASTEXITCODE -eq 0 -and $commit) {
      $commit.Trim()
    } else {
      "source-archive"
    }
  }
}

$buildLabel = if ($ExternalTest) { "external-test" } else { "release" }
Write-Host "== Vibe Usage for Windows $buildLabel build ==" -ForegroundColor Cyan

node scripts/check-version.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit 1 }

pnpm test
if ($LASTEXITCODE -ne 0) { exit 1 }

# tauri-build validates bundled resources even for cargo test on a fresh clone.
node scripts/fetch-node.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

cargo test --workspace
if ($LASTEXITCODE -ne 0) { exit 1 }
if ($ExternalTest) {
  cargo test --workspace --features external-test-diagnostics
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

# Release the reviewed, checked-in CLI snapshot rather than replacing it with
# npm's moving latest tag after tests have started.
node scripts/check-version.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

& (Join-Path $PSScriptRoot "build-tauri-windows.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$version = (Get-Content package.json | ConvertFrom-Json).version
$installer = Get-ChildItem -Path "target/release/bundle/nsis" -Filter "*$version*setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "No NSIS installer found for version $version."
}
$dest = if ($ExternalTest) {
  "VibeUsage-$version-Windows-External-Test-Setup.exe"
} else {
  "VibeUsage-$version-Windows-Setup.exe"
}
Copy-Item $installer.FullName $dest -Force
if (-not $ExternalTest) {
  node scripts/generate-updater-manifest.mjs $dest
}

Write-Host "`n✓ $dest" -ForegroundColor Green
if (-not $ExternalTest) {
  Write-Host "✓ latest.json" -ForegroundColor Green
}
