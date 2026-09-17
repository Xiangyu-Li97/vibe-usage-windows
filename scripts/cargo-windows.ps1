# Supported Cargo entry point for Windows workspaces, including long paths.
# Example: powershell -NoProfile -File scripts/cargo-windows.ps1 test --workspace
# Cargo itself has no dynamic pre-command hook to choose a per-user target.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-paths.ps1')
$oldLocation = (Get-Location).Path
$oldTarget = [Environment]::GetEnvironmentVariable('CARGO_TARGET_DIR', 'Process')
try {
  Set-Location (Join-Path $PSScriptRoot '..')
  $paths = Resolve-VibeBuildPaths -Workspace (Get-Location).Path
  if (-not $paths.ExplicitTarget) { $env:CARGO_TARGET_DIR = $paths.TargetDirectory }
  Write-Host "Cargo target: $($paths.TargetDirectory)"
  & cargo @args
  $result = $LASTEXITCODE
} finally {
  Set-Location $oldLocation
  [Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', $oldTarget, 'Process')
}
exit $result
