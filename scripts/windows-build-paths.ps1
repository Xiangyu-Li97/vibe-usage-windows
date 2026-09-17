# Shared by the release wrapper and the signing/build wrapper. Source paths
# remain canonical; only Cargo output is relocated to avoid MSVC MAX_PATH.
function Resolve-VibeBuildPaths {
  param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [string]$CargoTargetDir = $env:CARGO_TARGET_DIR,
    [string]$LocalAppData = $env:LOCALAPPDATA
  )

  $workspacePath = [System.IO.Path]::GetFullPath($Workspace)
  $explicitTarget = -not [string]::IsNullOrWhiteSpace($CargoTargetDir)
  $target = if ($explicitTarget) {
    if ([System.IO.Path]::IsPathRooted($CargoTargetDir)) {
      [System.IO.Path]::GetFullPath($CargoTargetDir)
    } else {
      [System.IO.Path]::GetFullPath((Join-Path $workspacePath $CargoTargetDir))
    }
  } else {
    Join-Path $workspacePath 'target'
  }

  # Reserve 140 characters for Cargo's release/build/<crate-hash>/... names.
  # An explicit override is authoritative, even if it is itself long.
  $automaticShortTarget = -not $explicitTarget -and $target.Length -gt 120
  if ($automaticShortTarget) {
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
      throw 'LOCALAPPDATA is unavailable; set CARGO_TARGET_DIR to a short writable directory.'
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($workspacePath.TrimEnd('\', '/').ToLowerInvariant())
      $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').Substring(0, 12).ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
    $target = Join-Path (Join-Path ([System.IO.Path]::GetFullPath($LocalAppData)) 'vbu-t') $hash
    if ($target.Length -gt 120) {
      throw 'The per-user Cargo cache path is also too long; set CARGO_TARGET_DIR explicitly to a short writable directory.'
    }
  }

  [PSCustomObject]@{
    Workspace = $workspacePath
    TargetDirectory = $target
    ReleaseDirectory = Join-Path $target 'release'
    InstallerDirectory = Join-Path (Join-Path (Join-Path $target 'release') 'bundle') 'nsis'
    ExplicitTarget = $explicitTarget
    AutomaticShortTarget = $automaticShortTarget
  }
}

function Find-VibeInstaller {
  param(
    [Parameter(Mandatory = $true)]$BuildPaths,
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$ExternalTest
  )
  $product = if ($ExternalTest) { 'Vibe Usage Test' } else { 'Vibe Usage' }
  $installer = Get-ChildItem -LiteralPath $BuildPaths.InstallerDirectory -Filter "${product}_${Version}_*-setup.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $installer) {
    throw "No NSIS installer found for $product $Version in $($BuildPaths.InstallerDirectory)."
  }
  return $installer
}
