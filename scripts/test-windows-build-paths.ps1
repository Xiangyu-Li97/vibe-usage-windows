# Runs on Windows PowerShell 5.1 / PowerShell 7 without downloads or a compiler.
# Exercises the real wrappers with fake node/pnpm/cargo/signature commands.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-paths.ps1')
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('vbu-path-test-' + [Guid]::NewGuid().ToString('N'))
$previousLocation = (Get-Location).Path
$environmentNames = @('CARGO_TARGET_DIR', 'LOCALAPPDATA', 'TAURI_FEATURES', 'TAURI_BUNDLES',
  'VIBE_USAGE_BUILD_KIND', 'VIBE_USAGE_APP_BUILD', 'VIBE_USAGE_APP_COMMIT',
  'WINDOWS_CODESIGN_CERT_THUMBPRINT', 'WINDOWS_CODESIGN_PFX_BASE64', 'WINDOWS_CODESIGN_PFX_PASSWORD',
  'SIGNPATH_API_TOKEN', 'SIGNPATH_ALLOW_UNTRUSTED_SIGNATURE')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$testState = @{ Checks = 0; VerifiedArtifacts = @() }
function Assert-PathTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $testState.Checks += 1
  Write-Host "PASS $Message"
}
try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  $shortWorkspace = Join-Path $testRoot 'source'
  $longWorkspace = Join-Path $testRoot ('long workspace ' + ('x' * 100))
  $localCache = Join-Path $testRoot 'local'
  $plain = Resolve-VibeBuildPaths -Workspace $shortWorkspace -CargoTargetDir '' -LocalAppData $localCache
  Assert-PathTest ($plain.TargetDirectory -eq (Join-Path $shortWorkspace 'target')) 'short workspaces keep target/'
  $short = Resolve-VibeBuildPaths -Workspace $longWorkspace -CargoTargetDir '' -LocalAppData $localCache
  Assert-PathTest $short.AutomaticShortTarget 'long workspaces choose a short target automatically'
  Assert-PathTest ($short.TargetDirectory.Length -le 120) 'automatic target reserves space for MSVC output names'
  $again = Resolve-VibeBuildPaths -Workspace $longWorkspace -CargoTargetDir '' -LocalAppData $localCache
  Assert-PathTest ($again.TargetDirectory -eq $short.TargetDirectory) 'target is stable across builds'
  $other = Resolve-VibeBuildPaths -Workspace ($longWorkspace + '-other') -CargoTargetDir '' -LocalAppData $localCache
  Assert-PathTest ($other.TargetDirectory -ne $short.TargetDirectory) 'different workspaces do not share targets'
  $relative = Resolve-VibeBuildPaths -Workspace $longWorkspace -CargoTargetDir 'custom-target' -LocalAppData $localCache
  Assert-PathTest ($relative.ExplicitTarget -and $relative.TargetDirectory -eq (Join-Path $longWorkspace 'custom-target')) 'relative user override is resolved against source and preserved'

  # Exercise both wrappers, including locating/copying and verifying artifacts
  # outside workspace/target. Never invoke the actual compiler or signing tool.
  $fixtureScripts = Join-Path $longWorkspace 'scripts'
  New-Item -ItemType Directory -Path $fixtureScripts -Force | Out-Null
  foreach ($file in @('windows-build-paths.ps1', 'release-windows.ps1', 'build-tauri-windows.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $fixtureScripts
  }
  Set-Content -LiteralPath (Join-Path $longWorkspace 'package.json') -Value '{"version":"0.0.0"}' -Encoding UTF8
  function node { $global:LASTEXITCODE = 0 }
  function cargo { $global:LASTEXITCODE = 0 }
  function pnpm {
    if ($args[0] -eq 'tauri') {
      Assert-PathTest ((Get-Location).Path -eq $longWorkspace) 'Vite runs from the original source directory'
      $paths = Resolve-VibeBuildPaths -Workspace $longWorkspace
      New-Item -ItemType Directory -Path $paths.InstallerDirectory -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $paths.InstallerDirectory 'Vibe Usage Test_0.0.0_x64-setup.exe') -Value 'test installer' -Encoding UTF8
      Set-Content -LiteralPath (Join-Path $paths.ReleaseDirectory 'vibe-usage-app.exe') -Value 'test application' -Encoding UTF8
      # A normal installer must never be selected by the external wrapper.
      Set-Content -LiteralPath (Join-Path $paths.InstallerDirectory 'Vibe Usage_0.0.0_x64-setup.exe') -Value 'wrong product' -Encoding UTF8
    }
    $global:LASTEXITCODE = 0
  }
  $testState.VerifiedArtifacts = @()
  function Get-AuthenticodeSignature($FilePath) {
    Assert-PathTest (Test-Path -LiteralPath $FilePath -PathType Leaf) 'signature verification uses an existing artifact in the actual target'
    $testState.VerifiedArtifacts += $FilePath
    return [PSCustomObject]@{ Status = 'Valid'; StatusMessage = 'test stub' }
  }
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $env:LOCALAPPDATA = $localCache
  $env:VIBE_USAGE_APP_COMMIT = 'test-fixture'
  $env:WINDOWS_CODESIGN_CERT_THUMBPRINT = 'test-stub-only'
  foreach ($override in @('', (Join-Path $testRoot 'user-selected-target'))) {
    $env:CARGO_TARGET_DIR = $override
    & (Join-Path $fixtureScripts 'release-windows.ps1') -ExternalTest
    Assert-PathTest ($LASTEXITCODE -eq 0) 'release wrapper completes with stubbed build'
    $expected = if ($override) { $override } else { $short.TargetDirectory }
    Assert-PathTest ($env:CARGO_TARGET_DIR -eq $expected) 'wrapper chooses automatic target or preserves explicit user override'
    $copied = Get-Content -LiteralPath (Join-Path $longWorkspace 'VibeUsage-0.0.0-Windows-External-Test-Setup.exe') -Raw
    Assert-PathTest ($copied.Trim() -eq 'test installer') 'release copies the external installer from the actual target'
    Assert-PathTest ($testState.VerifiedArtifacts[-2] -eq (Join-Path (Join-Path $expected 'release') 'vibe-usage-app.exe')) 'signing verifies the relocated application'
  }
  Write-Host "Build path regression: $($testState.Checks) checks passed."
} finally {
  Set-Location $previousLocation
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
