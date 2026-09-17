# Remap paths for this build only; encoded arguments preserve spaces in paths.
function Invoke-VibeRustPathRemapping {
  param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [Parameter(Mandatory = $true)][scriptblock]$Build
  )
  $oldEncoded = [Environment]::GetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', 'Process')
  $oldFlags = [Environment]::GetEnvironmentVariable('RUSTFLAGS', 'Process')
  $separator = [string][char]31
  $flags = @()
  if ($null -ne $oldEncoded) {
    if ($oldEncoded.Length) { $flags += $oldEncoded.Split([char]31) }
  } elseif (-not [string]::IsNullOrWhiteSpace($oldFlags)) {
    $flags += @($oldFlags -split '\s+' | Where-Object { $_.Length })
  }
  $roots = @(
    @{ Source = $env:USERPROFILE; Destination = '/vbu/home' },
    @{ Source = $env:CARGO_HOME; Destination = '/vbu/cargo' },
    @{ Source = $env:RUSTUP_HOME; Destination = '/vbu/rustup' },
    @{ Source = $Workspace; Destination = '/vbu/source' }
  )
  foreach ($root in $roots) {
    if ([string]::IsNullOrWhiteSpace($root.Source)) { continue }
    $source = [IO.Path]::GetFullPath($root.Source).TrimEnd('\', '/')
    foreach ($variant in @($source, $source.Replace('\', '/')) | Select-Object -Unique) {
      $flags += '--remap-path-prefix'
      $flags += "$variant=$($root.Destination)"
    }
  }
  try {
    [Environment]::SetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', ($flags -join $separator), 'Process')
    & $Build
  } finally {
    if ($null -eq $oldEncoded) { Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', $oldEncoded, 'Process') }
    if ($null -eq $oldFlags) { Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable('RUSTFLAGS', $oldFlags, 'Process') }
  }
}
