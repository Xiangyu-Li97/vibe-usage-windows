$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-rust-paths.ps1')
$oldEncoded = [Environment]::GetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', 'Process')
$oldFlags = [Environment]::GetEnvironmentVariable('RUSTFLAGS', 'Process')
$oldCargo = $env:CARGO_HOME
$oldRustup = $env:RUSTUP_HOME
$sep = [string][char]31
$checks = 0
function Assert-Remap([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:checks++
  Write-Output "PASS $Message"
}
try {
  $workspace = Join-Path $env:TEMP 'vbu source with spaces'
  $env:CARGO_HOME = Join-Path $env:TEMP 'custom cargo home'
  $env:RUSTUP_HOME = Join-Path $env:TEMP 'custom rustup home'
  $env:RUSTFLAGS = '--cfg preserved_flag -C opt-level=1'
  Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue
  Invoke-VibeRustPathRemapping -Workspace $workspace -Build {
    $parts = $env:CARGO_ENCODED_RUSTFLAGS.Split([char]31)
    Assert-Remap (($parts[0..3] -join ' ') -eq '--cfg preserved_flag -C opt-level=1') 'existing Rust flags preserved'
    Assert-Remap ($parts -contains "$workspace=/vbu/source") 'workspace path with spaces remains one argument'
    Assert-Remap ($parts -contains "$env:USERPROFILE=/vbu/home") 'user home remapped'
    Assert-Remap ($parts -contains "$env:CARGO_HOME=/vbu/cargo") 'custom Cargo home remapped'
    Assert-Remap ($parts -contains "$env:RUSTUP_HOME=/vbu/rustup") 'custom Rustup home remapped'
    Assert-Remap ($parts -contains ($workspace.Replace('\', '/') + '=/vbu/source')) 'forward slash variant remapped'
    $global:LASTEXITCODE = 23
  }
  Assert-Remap ($LASTEXITCODE -eq 23) 'native nonzero exit code preserved'
  Assert-Remap ($null -eq [Environment]::GetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', 'Process')) 'absent encoded flags restored'
  $encoded = @('--cfg', 'encoded_value="with spaces"') -join $sep
  $env:CARGO_ENCODED_RUSTFLAGS = $encoded
  $thrown = $false
  try {
    Invoke-VibeRustPathRemapping -Workspace $workspace -Build {
      Assert-Remap ($env:CARGO_ENCODED_RUSTFLAGS.StartsWith($encoded + $sep)) 'encoded flags retain precedence and spaces'
      Assert-Remap (!$env:CARGO_ENCODED_RUSTFLAGS.Contains('preserved_flag')) 'plain flags not duplicated when encoded flags exist'
      throw 'fixture failure'
    }
  } catch { if ($_.Exception.Message -ne 'fixture failure') { throw }; $thrown = $true }
  Assert-Remap $thrown 'build exception propagated'
  Assert-Remap ($env:CARGO_ENCODED_RUSTFLAGS -ceq $encoded) 'encoded caller environment restored after failure'
  Assert-Remap ($env:RUSTFLAGS -ceq '--cfg preserved_flag -C opt-level=1') 'plain caller environment restored'
  Write-Output "$checks checks passed"
} finally {
  [Environment]::SetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', $oldEncoded, 'Process')
  [Environment]::SetEnvironmentVariable('RUSTFLAGS', $oldFlags, 'Process')
  [Environment]::SetEnvironmentVariable('CARGO_HOME', $oldCargo, 'Process')
  [Environment]::SetEnvironmentVariable('RUSTUP_HOME', $oldRustup, 'Process')
}
