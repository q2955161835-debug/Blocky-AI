$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$previousTarget = $env:CARGO_TARGET_DIR
try {
  $env:CARGO_TARGET_DIR = Join-Path $taskRoot 'try/native-e2e-target'
  Push-Location $taskRoot
  try {
    & node scripts/build-runtime-worker.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & pnpm --dir tools/blocky-cli exec node build.mjs --bundle-only
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/build-builder.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/build-document-parser.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-document-parser.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-knowledge-models.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-audio-runtime.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-builder.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-runtime-worker.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/build-browser.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-browser.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/prepare-native-runtime.mjs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & cargo build --manifest-path apps/studio-host/Cargo.toml --release --locked --bin blocky-project-io
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & node scripts/install-coding-cli.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & pnpm --dir apps/studio-host tauri build --no-bundle --features wdio --config tauri.wdio.conf.json
    $taskExit = $LASTEXITCODE
    if($taskExit -eq 0){Copy-Item -LiteralPath (Join-Path $taskRoot 'try/stage3/runtime/DirectML.dll') -Destination (Join-Path $env:CARGO_TARGET_DIR 'release/DirectML.dll')}
  } finally { Pop-Location }
} finally { $env:CARGO_TARGET_DIR = $previousTarget }
exit $taskExit
