$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$previousTarget=$env:CARGO_TARGET_DIR
$previousFlags=$env:CARGO_ENCODED_RUSTFLAGS
$previousRustFlags=$env:RUSTFLAGS
try {
 $env:CARGO_TARGET_DIR=Join-Path $taskRoot 'try/release-native-target'
 $env:RUSTFLAGS=$null
 $prefixes=@($taskRoot,$taskRoot.Replace('\','/'),$env:USERPROFILE,$env:USERPROFILE.Replace('\','/'))|Select-Object -Unique
 $flags=@();foreach($prefix in $prefixes){$flags+="--remap-path-prefix=$prefix=/build"}
 $env:CARGO_ENCODED_RUSTFLAGS=$flags -join [char]31
 Push-Location $taskRoot
 try {
  & pnpm --dir apps/studio-host tauri build --no-bundle
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & cargo build --manifest-path apps/studio-host/Cargo.toml --release --bin blocky-project-io
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & pnpm --dir tools/blocky-cli exec node build.mjs (Join-Path $env:CARGO_TARGET_DIR 'release/blocky-project-io.exe')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 } finally { Pop-Location }
} finally {$env:CARGO_TARGET_DIR=$previousTarget;$env:CARGO_ENCODED_RUSTFLAGS=$previousFlags;$env:RUSTFLAGS=$previousRustFlags}
