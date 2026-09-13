function Resolve-VibePnpmBin {
  param([string]$PnpmEntry = $env:npm_execpath)
  if (-not $PnpmEntry -or -not (Test-Path -LiteralPath $PnpmEntry -PathType Leaf)) { return $null }
  # npm/pnpm run carries the absolute CLI entry even when the caller launched
  # an isolated pnpm.cjs directly and omitted its shim directory from PATH.
  if ([System.IO.Path]::GetFileName($PnpmEntry) -notmatch '^pnpm\.(c?js|exe)$') { return $null }
  $dir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($PnpmEntry))
  for ($depth = 0; $depth -lt 4 -and $dir; $depth++) {
    foreach ($candidate in @($dir, (Join-Path $dir '.bin'))) {
      if (Test-Path -LiteralPath (Join-Path $candidate 'pnpm.cmd') -PathType Leaf) { return $candidate }
      if (Test-Path -LiteralPath (Join-Path $candidate 'pnpm.exe') -PathType Leaf) { return $candidate }
    }
    $dir = [System.IO.Path]::GetDirectoryName($dir)
  }
  return $null
}

function Initialize-VibeBuildTools {
  if ($env:npm_node_execpath -and (Test-Path -LiteralPath $env:npm_node_execpath -PathType Leaf)) {
    $nodeBin = [System.IO.Path]::GetDirectoryName($env:npm_node_execpath)
    $env:Path = $nodeBin + [System.IO.Path]::PathSeparator + $env:Path
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $pnpmBin = Resolve-VibePnpmBin
    if (-not $pnpmBin) {
      throw 'pnpm is unavailable to the build shell. Add your existing pnpm 10 shim directory to PATH, or launch this release through pnpm run release:windows:test.'
    }
    $env:Path = $pnpmBin + [System.IO.Path]::PathSeparator + $env:Path
  }
}
