$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$previousTarget = $env:CARGO_TARGET_DIR
try {
  $env:CARGO_TARGET_DIR = Join-Path $taskRoot 'try/native-e2e-target'
  Push-Location $taskRoot
  try {
    & pnpm --dir apps/studio-host tauri build --no-bundle --features wdio --config tauri.wdio.conf.json
    $taskExit = $LASTEXITCODE
  } finally { Pop-Location }
} finally { $env:CARGO_TARGET_DIR = $previousTarget }
exit $taskExit
