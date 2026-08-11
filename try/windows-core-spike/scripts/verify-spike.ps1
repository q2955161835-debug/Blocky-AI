[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$IncludeSoak
)

$ErrorActionPreference = 'Stop'
$script:FirstExitCode = 0
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
$exePath = Join-Path $projectRoot 'src-tauri\target\release\blocky-windows-core-spike.exe'
$sensitiveScanPath = Join-Path $projectRoot 'tests\security\repository-sensitive-scan.ps1'

function Set-FirstFailure([int]$ExitCode) {
    if ($script:FirstExitCode -eq 0) {
        $script:FirstExitCode = if ($ExitCode -eq 0) { 1 } else { $ExitCode }
    }
}

function Invoke-ExternalGate(
    [string]$Label,
    [string]$Executable,
    [string[]]$Arguments
) {
    [Console]::Out.WriteLine(('VERIFY_START {0}' -f $Label))
    & $Executable @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Set-FirstFailure -ExitCode $exitCode
        throw ('VERIFY_FAILED {0} exit={1}' -f $Label, $exitCode)
    }
    [Console]::Out.WriteLine(('VERIFY_PASS {0}' -f $Label))
}

function Assert-NormalIsolation {
    $tree = & cargo tree --manifest-path $manifestPath --locked --no-default-features -e normal
    $treeExitCode = $LASTEXITCODE
    if ($treeExitCode -ne 0) {
        Set-FirstFailure -ExitCode $treeExitCode
        throw ('VERIFY_FAILED normal-cargo-tree exit={0}' -f $treeExitCode)
    }
    if ($tree -match '(?i)wdio|webdriver') {
        Set-FirstFailure -ExitCode 1
        throw 'NORMAL_ISOLATION_CARGO_TREE_CONTAINS_WDIO'
    }

    $normalConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
    $normalConfig = Get-Content -LiteralPath $normalConfigPath -Raw | ConvertFrom-Json
    if ($normalConfig.app.withGlobalTauri -ne $false) {
        Set-FirstFailure -ExitCode 1
        throw 'NORMAL_ISOLATION_GLOBAL_TAURI_ENABLED'
    }

    $capabilityRoot = Join-Path $projectRoot 'src-tauri\capabilities'
    $capabilityFiles = @(Get-ChildItem -LiteralPath $capabilityRoot -File)
    if ($capabilityFiles.Count -ne 1 -or $capabilityFiles[0].Name -ne 'main.json') {
        Set-FirstFailure -ExitCode 1
        throw 'NORMAL_ISOLATION_CAPABILITY_SET_INVALID'
    }
    $capability = Get-Content -LiteralPath $capabilityFiles[0].FullName -Raw |
        ConvertFrom-Json
    $expectedPermissions = @(
        'core:default',
        'core:window:allow-minimize',
        'core:window:allow-toggle-maximize',
        'core:window:allow-close',
        'core:window:allow-start-dragging'
    )
    $actualPermissions = @($capability.permissions)
    if (
        $capability.identifier -ne 'main' -or
        $actualPermissions.Count -ne $expectedPermissions.Count -or
        ($actualPermissions -join "`n") -ne ($expectedPermissions -join "`n")
    ) {
        Set-FirstFailure -ExitCode 1
        throw 'NORMAL_ISOLATION_CAPABILITY_CONTENT_INVALID'
    }

    $markers = @(
        'wdioTauri',
        '__BLOCKY_SPIKE_TEST__',
        'wdio:default',
        'withGlobalTauri',
        'WDIO_HOOK',
        '折叠首块'
    )
    $distFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -Recurse -File)
    foreach ($marker in $markers) {
        $matches = @($distFiles | Select-String -SimpleMatch -Pattern $marker)
        if ($matches.Count -ne 0) {
            Set-FirstFailure -ExitCode 1
            throw ('NORMAL_ISOLATION_DIST_MARKER:{0}:{1}' -f $marker, $matches.Count)
        }
    }
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        Set-FirstFailure -ExitCode 1
        throw 'NORMAL_ISOLATION_EXE_MISSING'
    }
    $exe = Get-Item -LiteralPath $exePath
    $hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
    [Console]::Out.WriteLine(
        ('NORMAL_EXE bytes={0} sha256={1}' -f $exe.Length, $hash)
    )
    [Console]::Out.WriteLine(
        'NORMAL_ISOLATION markers=0 cargo_wdio=0 capability=main custom_window=4'
    )
}

function Restore-NormalRelease {
    Invoke-ExternalGate -Label 'normal-release-build' -Executable 'pnpm' -Arguments @(
        'tauri', 'build', '--no-bundle'
    )
    Assert-NormalIsolation
}

function Invoke-NativeGate(
    [string]$Label,
    [string]$SpecPath
) {
    $pendingError = $null
    try {
        Invoke-ExternalGate -Label ($Label + '-wdio-build') -Executable 'pnpm' -Arguments @(
            'test:e2e:build'
        )
        if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
            Set-FirstFailure -ExitCode 1
            throw 'WDIO_EXE_MISSING'
        }
        $wdioExe = Get-Item -LiteralPath $exePath
        $wdioHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
        [Console]::Out.WriteLine(
            ('WDIO_EXE gate={0} bytes={1} sha256={2}' -f
                $Label,
                $wdioExe.Length,
                $wdioHash)
        )

        Invoke-ExternalGate -Label ($Label + '-artifact-reset') -Executable 'node' -Arguments @(
            '.\scripts\prepare-wdio-artifacts.mjs'
        )
        Invoke-ExternalGate -Label $Label -Executable 'pnpm' -Arguments @(
            'exec', 'wdio', 'run', '.\wdio.conf.ts', '--spec', $SpecPath
        )
        Invoke-ExternalGate -Label ($Label + '-log-audit') -Executable 'node' -Arguments @(
            '.\scripts\audit-wdio-logs.mjs'
        )
        Invoke-ExternalGate -Label ($Label + '-sensitive-scan') -Executable 'pwsh' -Arguments @(
                '-NoProfile',
                '-File',
                $sensitiveScanPath,
                '-UseWdioArtifacts'
        )
    }
    catch {
        $pendingError = $_
    }

    try {
        Restore-NormalRelease
    }
    catch {
        if ($null -eq $pendingError) {
            $pendingError = $_
        }
    }

    if ($null -ne $pendingError) {
        throw $pendingError
    }
}

Push-Location -LiteralPath $projectRoot
try {
    Invoke-ExternalGate -Label 'unit-tests' -Executable 'pnpm' -Arguments @('test:unit')
    Invoke-ExternalGate -Label 'component-tests' -Executable 'pnpm' -Arguments @('test:component')
    Invoke-ExternalGate -Label 'typescript-normal-build' -Executable 'pnpm' -Arguments @('build')
    Invoke-ExternalGate -Label 'rust-fmt' -Executable 'cargo' -Arguments @(
        'fmt', '--manifest-path', $manifestPath, '--all', '--', '--check'
    )
    Invoke-ExternalGate -Label 'rust-clippy-normal' -Executable 'cargo' -Arguments @(
            'clippy',
            '--manifest-path', $manifestPath,
            '--locked',
            '--no-default-features',
            '--all-targets',
            '--',
            '-D',
            'warnings'
    )
    Invoke-ExternalGate -Label 'rust-clippy-all-features' -Executable 'cargo' -Arguments @(
            'clippy',
            '--manifest-path', $manifestPath,
            '--locked',
            '--all-features',
            '--all-targets',
            '--',
            '-D',
            'warnings'
    )
    Invoke-ExternalGate -Label 'rust-tests' -Executable 'cargo' -Arguments @(
        'test', '--manifest-path', $manifestPath, '--locked'
    )
    Invoke-ExternalGate -Label 'repository-sensitive-scan' -Executable 'pwsh' -Arguments @(
        '-NoProfile', '-File', $sensitiveScanPath
    )

    if (-not $Fast) {
        Invoke-NativeGate -Label 'native-core-e2e' -SpecPath '.\tests\e2e\windows-core.e2e.ts'
        Invoke-NativeGate -Label 'native-performance-e2e' -SpecPath '.\tests\e2e\windows-core-performance.e2e.ts'
        if ($IncludeSoak) {
            Invoke-NativeGate -Label 'native-soak-e2e' -SpecPath '.\tests\e2e\windows-core-soak.e2e.ts'
        }
    }

    [Console]::Out.WriteLine(
        ('VERIFY_SPIKE_PASS fast={0} includeSoak={1}' -f
            $Fast.IsPresent,
            $IncludeSoak.IsPresent)
    )
}
catch {
    if ($script:FirstExitCode -eq 0) {
        $script:FirstExitCode = 1
    }
    [Console]::Error.WriteLine($_.Exception.Message)
}
finally {
    Pop-Location
}

exit $script:FirstExitCode
