$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$previousTarget = $env:CARGO_TARGET_DIR
try {
  $env:CARGO_TARGET_DIR = Join-Path $taskRoot 'try/native-e2e-target'
  Push-Location $taskRoot
  try {
    & node scripts/build-builder.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-builder.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/prepare-native-runtime.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & pnpm --dir apps/studio-host tauri build --no-bundle --features wdio --config tauri.wdio.conf.json
    $taskExit = $LASTEXITCODE
    if($taskExit -eq 0){Copy-Item -LiteralPath (Join-Path $taskRoot 'try/stage3/runtime/DirectML.dll') -Destination (Join-Path $env:CARGO_TARGET_DIR 'release/DirectML.dll')}
  } finally { Pop-Location }
} finally { $env:CARGO_TARGET_DIR = $previousTarget }
exit $taskExit
