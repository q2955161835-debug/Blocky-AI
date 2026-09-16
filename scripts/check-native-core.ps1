param([ValidateSet('core','full')][string]$Suite='core')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$previousSuite=$env:BLOCKY_NATIVE_SUITE
try {
 $env:BLOCKY_NATIVE_SUITE=$Suite
 Push-Location $taskRoot
 try { & pnpm exec wdio run tests/e2e/wdio.conf.ts; $taskExit=$LASTEXITCODE } finally { Pop-Location }
} finally { $env:BLOCKY_NATIVE_SUITE=$previousSuite }
exit $taskExit
