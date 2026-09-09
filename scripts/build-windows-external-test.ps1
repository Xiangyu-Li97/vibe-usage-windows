# Local one-shot external-test build. This stays entirely on the Windows
# machine: it prepares missing tools, runs tests, and creates an unsigned NSIS
# installer with the redacted diagnostics feature enabled.

$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
Set-Location $root

& (Join-Path $PSScriptRoot "setup-windows-build-env.ps1")
& (Join-Path $PSScriptRoot "release-windows.ps1") -ExternalTest
