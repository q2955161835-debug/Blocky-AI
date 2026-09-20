$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$previousTarget=$env:CARGO_TARGET_DIR
$previousFlags=$env:CARGO_ENCODED_RUSTFLAGS
$previousRustFlags=$env:RUSTFLAGS
$previousCFlags=$env:CFLAGS
$previousCxxFlags=$env:CXXFLAGS
$previousShellFlags=$env:CC_SHELL_ESCAPED_FLAGS
try {
 $env:CARGO_TARGET_DIR=Join-Path $taskRoot 'try/release-native-target'
 $env:RUSTFLAGS=$null
 $prefixes=@($taskRoot,$taskRoot.Replace('\','/'),$env:USERPROFILE,$env:USERPROFILE.Replace('\','/'))|Select-Object -Unique
 $flags=@();foreach($prefix in $prefixes){$flags+="--remap-path-prefix=$prefix=/build"}
 $env:CARGO_ENCODED_RUSTFLAGS=$flags -join [char]31
 # Rust remapping does not reach native C/C++ dependencies (for example aws-lc).
 # MSVC requires deterministic mode for /pathmap to rewrite __FILE__ as well.
 $nativeMaps=($prefixes | ForEach-Object { '"/pathmap:'+$_+'=/build"' }) -join ' '
 $env:CFLAGS=(@($previousCFlags,'/experimental:deterministic',$nativeMaps) | Where-Object { $_ }) -join ' '
 $env:CXXFLAGS=(@($previousCxxFlags,'/experimental:deterministic',$nativeMaps) | Where-Object { $_ }) -join ' '
 $env:CC_SHELL_ESCAPED_FLAGS='1'
 Push-Location $taskRoot
 try {
  & node scripts/build-builder.mjs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & node scripts/install-builder.mjs (Join-Path $env:CARGO_TARGET_DIR 'release')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & node scripts/prepare-knowledge-model.mjs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & node scripts/prepare-native-runtime.mjs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  Push-Location (Join-Path $taskRoot 'apps/studio-host')
  try { & node node_modules/@tauri-apps/cli/tauri.js build --no-bundle -- --locked }
  finally { Pop-Location }
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & cargo build --manifest-path apps/studio-host/Cargo.toml --release --locked --bin blocky-project-io
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & pnpm --dir tools/blocky-cli exec node build.mjs (Join-Path $env:CARGO_TARGET_DIR 'release/blocky-project-io.exe')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  Copy-Item -LiteralPath (Join-Path $taskRoot 'try/stage3/runtime/DirectML.dll') -Destination (Join-Path $env:CARGO_TARGET_DIR 'release/DirectML.dll')
  & pnpm licenses list --prod --json | Out-File -Encoding utf8NoBOM (Join-Path $taskRoot 'try/production-js-licenses.json')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & cargo metadata --manifest-path apps/studio-host/Cargo.toml --format-version 1 --locked --filter-platform x86_64-pc-windows-msvc | Out-File -Encoding utf8NoBOM (Join-Path $taskRoot 'try/production-rust-metadata.json')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & node scripts/third-party-notices.mjs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 } finally { Pop-Location }
} finally {$env:CARGO_TARGET_DIR=$previousTarget;$env:CARGO_ENCODED_RUSTFLAGS=$previousFlags;$env:RUSTFLAGS=$previousRustFlags;$env:CFLAGS=$previousCFlags;$env:CXXFLAGS=$previousCxxFlags;$env:CC_SHELL_ESCAPED_FLAGS=$previousShellFlags}
