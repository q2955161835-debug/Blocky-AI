[CmdletBinding()]
param(
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param(
        [Parameter(Mandatory)][string]$Area,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][bool]$Passed,
        [Parameter(Mandatory)][string]$Detail
    )

    $checks.Add([pscustomobject]@{
        area   = $Area
        check  = $Name
        status = if ($Passed) { 'PASS' } else { 'FAIL' }
        detail = $Detail
    })
}

function Get-FirstLine {
    param([Parameter(Mandatory)][scriptblock]$Command)

    try {
        $output = & $Command 2>&1
        return (($output | Select-Object -First 1) -as [string]).Trim()
    }
    catch {
        return $_.Exception.Message
    }
}

function Add-CommandCheck {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$VersionCommand
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        Add-Check -Area 'Core' -Name $Name -Passed $false -Detail 'Command not found'
        return
    }

    $version = Get-FirstLine -Command $VersionCommand
    Add-Check -Area 'Core' -Name $Name -Passed ([bool]$version) -Detail $version
}

Add-CommandCheck -Name 'git' -VersionCommand { git --version }
Add-CommandCheck -Name 'node' -VersionCommand { node --version }
Add-CommandCheck -Name 'pnpm' -VersionCommand { pnpm --version }
Add-CommandCheck -Name 'rustc' -VersionCommand { rustc --version }
Add-CommandCheck -Name 'cargo' -VersionCommand { cargo --version }
Add-CommandCheck -Name 'rustup' -VersionCommand { rustup --version }
Add-CommandCheck -Name 'java' -VersionCommand { java -version }

$vswhereCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
)
$vswhere = $vswhereCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$vsInstall = $null
if ($vswhere) {
    $vsInstall = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
Add-Check -Area 'Windows' -Name 'Visual Studio C++ Build Tools' -Passed ([bool]$vsInstall) -Detail $(if ($vsInstall) { $vsInstall } else { 'Required C++ workload not found' })

$webView = $null
$edgeClientRoots = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients'
)
foreach ($root in $edgeClientRoots) {
    if (-not (Test-Path $root)) {
        continue
    }
    foreach ($key in Get-ChildItem $root) {
        $properties = Get-ItemProperty $key.PSPath
        if ($properties.PSObject.Properties['name'] -and $properties.name -match 'WebView2') {
            $version = if ($properties.PSObject.Properties['pv']) { $properties.pv } else { 'version unknown' }
            $webView = "$($properties.name) $version"
            break
        }
    }
    if ($webView) {
        break
    }
}
Add-Check -Area 'Windows' -Name 'WebView2 Runtime' -Passed ([bool]$webView) -Detail $(if ($webView) { $webView } else { 'Runtime not found in EdgeUpdate registry' })

$windowsKit = 'C:\Program Files (x86)\Windows Kits\10\Include'
$kitVersions = @(if (Test-Path -LiteralPath $windowsKit) { Get-ChildItem -LiteralPath $windowsKit -Directory | Select-Object -ExpandProperty Name } else { @() })
Add-Check -Area 'Windows' -Name 'Windows SDK' -Passed ($kitVersions.Count -gt 0) -Detail $(if ($kitVersions.Count -gt 0) { ($kitVersions -join ', ') } else { 'Windows 10 SDK not found' })

$androidHome = $env:ANDROID_HOME
if (-not $androidHome) {
    $androidHome = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User')
}
Add-Check -Area 'Android' -Name 'ANDROID_HOME' -Passed ([bool]$androidHome -and (Test-Path -LiteralPath $androidHome)) -Detail $(if ($androidHome) { $androidHome } else { 'Not configured' })

if ($androidHome -and (Test-Path -LiteralPath $androidHome)) {
    $adb = Join-Path $androidHome 'platform-tools\adb.exe'
    $sdkManager = Join-Path $androidHome 'cmdline-tools\latest\bin\sdkmanager.bat'
    $platforms = @(Get-ChildItem -LiteralPath (Join-Path $androidHome 'platforms') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $buildTools = @(Get-ChildItem -LiteralPath (Join-Path $androidHome 'build-tools') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $sdkManagerVersion = if (Test-Path -LiteralPath $sdkManager) {
        $sdkManagerOutput = @(& $sdkManager --version 2>&1)
        $versionLine = $sdkManagerOutput | Where-Object { $_ -match '^\d+(\.\d+)+$' } | Select-Object -First 1
        if ($versionLine) { [string]$versionLine } else { [string]($sdkManagerOutput | Select-Object -First 1) }
    } else {
        'sdkmanager.bat missing'
    }

    Add-Check -Area 'Android' -Name 'adb' -Passed (Test-Path -LiteralPath $adb) -Detail $(if (Test-Path -LiteralPath $adb) { Get-FirstLine { & $adb version } } else { 'platform-tools/adb.exe missing' })
    Add-Check -Area 'Android' -Name 'SDK Platform' -Passed ($platforms.Count -gt 0) -Detail $(if ($platforms.Count -gt 0) { ($platforms -join ', ') } else { 'No Android platform installed' })
    Add-Check -Area 'Android' -Name 'Build Tools' -Passed ($buildTools.Count -gt 0) -Detail $(if ($buildTools.Count -gt 0) { ($buildTools -join ', ') } else { 'No Android build-tools installed' })
    Add-Check -Area 'Android' -Name 'Command-line Tools' -Passed (Test-Path -LiteralPath $sdkManager) -Detail $sdkManagerVersion
}

$ndkHome = $env:NDK_HOME
if (-not $ndkHome) {
    $ndkHome = [Environment]::GetEnvironmentVariable('NDK_HOME', 'User')
}
$ndkProperties = if ($ndkHome) { Join-Path $ndkHome 'source.properties' } else { $null }
$ndkDetail = if ($ndkProperties -and (Test-Path -LiteralPath $ndkProperties)) {
    (Get-Content -LiteralPath $ndkProperties | Where-Object { $_ -match '^Pkg\.Revision' }) -join '; '
} else {
    'NDK_HOME is not configured or source.properties is missing'
}
Add-Check -Area 'Android' -Name 'NDK' -Passed ([bool]$ndkProperties -and (Test-Path -LiteralPath $ndkProperties)) -Detail $ndkDetail

$requiredTargets = @(
    'aarch64-linux-android',
    'armv7-linux-androideabi',
    'i686-linux-android',
    'x86_64-linux-android'
)
$installedTargets = if (Get-Command rustup -ErrorAction SilentlyContinue) { @(rustup target list --installed) } else { @() }
foreach ($target in $requiredTargets) {
    Add-Check -Area 'Android' -Name "Rust target $target" -Passed ($installedTargets -contains $target) -Detail $(if ($installedTargets -contains $target) { 'Installed' } else { 'Missing' })
}

$androidStudioCandidates = @(
    'D:\Android\Android_Studio_Setup\bin\studio64.exe',
    (Join-Path $env:ProgramFiles 'Android\Android Studio\bin\studio64.exe')
)
$androidStudio = $androidStudioCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
Add-Check -Area 'Android' -Name 'Android Studio' -Passed ([bool]$androidStudio) -Detail $(if ($androidStudio) { $androidStudio } else { 'Android Studio not found' })

$devEcoCandidates = [System.Collections.Generic.List[string]]::new()
$configuredDevEco = [Environment]::GetEnvironmentVariable('DEVECO_STUDIO_HOME', 'User')
if ($configuredDevEco) {
    $devEcoCandidates.Add($configuredDevEco)
}
$devEcoBin = [Environment]::GetEnvironmentVariable('DevEco Studio', 'Process')
if ($devEcoBin) {
    $devEcoCandidates.Add((Split-Path -Parent $devEcoBin.TrimEnd(';', '\')))
}
$devEcoCandidates.Add('D:\Deveco_Studio\DevEco Studio')
$devEcoCandidates.Add((Join-Path $env:ProgramFiles 'Huawei\DevEco Studio'))
$devEcoHome = $devEcoCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

$productInfoPath = if ($devEcoHome) { Join-Path $devEcoHome 'product-info.json' } else { $null }
$devEcoVersion = if ($productInfoPath -and (Test-Path -LiteralPath $productInfoPath)) { (Get-Content -Raw -LiteralPath $productInfoPath | ConvertFrom-Json).version } else { 'Not found' }
Add-Check -Area 'HarmonyOS' -Name 'DevEco Studio' -Passed ([bool]$devEcoHome) -Detail $(if ($devEcoHome) { "$devEcoVersion at $devEcoHome" } else { 'DevEco Studio not found' })

if ($devEcoHome) {
    $sdkPackage = Join-Path $devEcoHome 'sdk\default\sdk-pkg.json'
    $ohpm = Join-Path $devEcoHome 'tools\ohpm\bin\ohpm.bat'
    $hvigor = Join-Path $devEcoHome 'tools\hvigor\bin\hvigorw.bat'
    $hdc = Join-Path $devEcoHome 'sdk\default\openharmony\toolchains\hdc.exe'
    $sdkDetail = if (Test-Path -LiteralPath $sdkPackage) {
        $sdk = Get-Content -Raw -LiteralPath $sdkPackage | ConvertFrom-Json
        "$($sdk.data.displayName), API $($sdk.data.apiVersion), $($sdk.data.version)"
    } else {
        'sdk-pkg.json missing'
    }

    Add-Check -Area 'HarmonyOS' -Name 'HarmonyOS SDK' -Passed (Test-Path -LiteralPath $sdkPackage) -Detail $sdkDetail
    Add-Check -Area 'HarmonyOS' -Name 'ohpm' -Passed (Test-Path -LiteralPath $ohpm) -Detail $(if (Test-Path -LiteralPath $ohpm) { Get-FirstLine { & $ohpm --version } } else { 'ohpm.bat missing' })
    Add-Check -Area 'HarmonyOS' -Name 'hvigor' -Passed (Test-Path -LiteralPath $hvigor) -Detail $(if (Test-Path -LiteralPath $hvigor) { Get-FirstLine { & $hvigor --version } } else { 'hvigorw.bat missing' })
    Add-Check -Area 'HarmonyOS' -Name 'hdc' -Passed (Test-Path -LiteralPath $hdc) -Detail $(if (Test-Path -LiteralPath $hdc) { Get-FirstLine { & $hdc version } } else { 'hdc.exe missing' })
}

$failed = @($checks | Where-Object { $_.status -eq 'FAIL' })
$summary = [pscustomobject]@{
    ok      = $failed.Count -eq 0
    passed  = $checks.Count - $failed.Count
    failed  = $failed.Count
    checks  = $checks
}

if ($Json) {
    $summary | ConvertTo-Json -Depth 5
}
else {
    $checks | Format-Table -AutoSize
    Write-Host "Result: $($summary.passed)/$($checks.Count) checks passed."
}

if (-not $summary.ok) {
    exit 1
}
