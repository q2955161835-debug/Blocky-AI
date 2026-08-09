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

function Invoke-CommandProbe {
    param([Parameter(Mandatory)][scriptblock]$Command)

    $existingExitCode = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
    $previousExitCode = if ($existingExitCode) { $existingExitCode.Value } else { $null }
    try {
        $global:LASTEXITCODE = 0
        $output = @(& $Command 2>&1)
        $exitCode = $global:LASTEXITCODE
        $detail = (($output | Select-Object -First 1) -as [string]).Trim()
        if (-not $detail) {
            $detail = if ($exitCode -eq 0) { 'Command returned no version output' } else { "Command failed with exit code $exitCode" }
        }

        return [pscustomobject]@{
            Passed   = $exitCode -eq 0
            Detail   = $detail
            ExitCode = $exitCode
            Output   = @($output | ForEach-Object { [string]$_ })
        }
    }
    catch {
        return [pscustomobject]@{
            Passed   = $false
            Detail   = $_.Exception.Message
            ExitCode = $null
            Output   = @()
        }
    }
    finally {
        if ($existingExitCode) {
            $global:LASTEXITCODE = $previousExitCode
        }
        else {
            Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
        }
    }
}

function Add-CommandCheck {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$VersionCommand,
        [scriptblock]$ValidateOutput,
        [string]$Requirement
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        Add-Check -Area 'Core' -Name $Name -Passed $false -Detail 'Command not found'
        return
    }

    $probe = Invoke-CommandProbe -Command $VersionCommand
    $passed = $probe.Passed
    $detail = $probe.Detail
    if ($passed -and $ValidateOutput) {
        $passed = [bool](& $ValidateOutput $probe.Detail)
        if (-not $passed -and $Requirement) {
            $detail = "$detail; requires $Requirement"
        }
    }

    Add-Check -Area 'Core' -Name $Name -Passed $passed -Detail $detail
}

Add-CommandCheck -Name 'git' -VersionCommand { git --version }
Add-CommandCheck -Name 'node' -VersionCommand { node --version }
Add-CommandCheck -Name 'pnpm' -VersionCommand { pnpm --version }
Add-CommandCheck -Name 'rustc' -VersionCommand { rustc --version }
Add-CommandCheck -Name 'cargo' -VersionCommand { cargo --version }
Add-CommandCheck -Name 'rustup' -VersionCommand { rustup --version }
Add-CommandCheck -Name 'java' -VersionCommand { java -version } -Requirement 'Java 17 or newer' -ValidateOutput {
    param($VersionLine)
    if ($VersionLine -notmatch 'version\s+"(?<major>\d+)') {
        return $false
    }
    return [int]$Matches.major -ge 17
}

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
$androidHomeValid = [bool]$androidHome -and (Test-Path -LiteralPath $androidHome)
Add-Check -Area 'Android' -Name 'ANDROID_HOME' -Passed $androidHomeValid -Detail $(if ($androidHome) { $androidHome } else { 'Not configured' })

$adbProbe = $null
$sdkManagerProbe = $null
$platforms = @()
$buildTools = @()
$sdkManagerVersion = if ($androidHomeValid) { 'sdkmanager.bat missing' } else { 'Skipped because ANDROID_HOME is invalid' }
if ($androidHomeValid) {
    $adb = Join-Path $androidHome 'platform-tools\adb.exe'
    $sdkManager = Join-Path $androidHome 'cmdline-tools\latest\bin\sdkmanager.bat'
    $platforms = @(Get-ChildItem -LiteralPath (Join-Path $androidHome 'platforms') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $buildTools = @(Get-ChildItem -LiteralPath (Join-Path $androidHome 'build-tools') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    if (Test-Path -LiteralPath $sdkManager) {
        $sdkManagerProbe = Invoke-CommandProbe { & $sdkManager --version }
        $versionLine = $sdkManagerProbe.Output | Where-Object { $_ -match '^\d+(\.\d+)+$' } | Select-Object -First 1
        $sdkManagerVersion = if ($versionLine) { [string]$versionLine } else { $sdkManagerProbe.Detail }
    }

    $adbProbe = if (Test-Path -LiteralPath $adb) { Invoke-CommandProbe { & $adb version } } else { $null }
}

$platformApiLevels = @($platforms | ForEach-Object { if ($_ -match '^android-(\d+)$') { [int]$Matches[1] } })
$platformPassed = @($platformApiLevels | Where-Object { $_ -ge 29 }).Count -gt 0
$platformDetail = if ($platforms.Count -gt 0) { $platforms -join ', ' } elseif ($androidHomeValid) { 'No Android platform installed' } else { 'Skipped because ANDROID_HOME is invalid' }
if ($platforms.Count -gt 0 -and -not $platformPassed) { $platformDetail = "$platformDetail; requires API 29 or newer" }
$buildToolMajors = @($buildTools | ForEach-Object { if ($_ -match '^(\d+)') { [int]$Matches[1] } })
$buildToolsPassed = @($buildToolMajors | Where-Object { $_ -ge 29 }).Count -gt 0
$buildToolsDetail = if ($buildTools.Count -gt 0) { $buildTools -join ', ' } elseif ($androidHomeValid) { 'No Android build-tools installed' } else { 'Skipped because ANDROID_HOME is invalid' }
if ($buildTools.Count -gt 0 -and -not $buildToolsPassed) { $buildToolsDetail = "$buildToolsDetail; requires version 29 or newer" }

Add-Check -Area 'Android' -Name 'adb' -Passed ([bool]$adbProbe -and $adbProbe.Passed) -Detail $(if ($adbProbe) { $adbProbe.Detail } elseif ($androidHomeValid) { 'platform-tools/adb.exe missing' } else { 'Skipped because ANDROID_HOME is invalid' })
Add-Check -Area 'Android' -Name 'SDK Platform' -Passed $platformPassed -Detail $platformDetail
Add-Check -Area 'Android' -Name 'Build Tools' -Passed $buildToolsPassed -Detail $buildToolsDetail
Add-Check -Area 'Android' -Name 'Command-line Tools' -Passed ([bool]$sdkManagerProbe -and $sdkManagerProbe.Passed) -Detail $sdkManagerVersion

$ndkHome = $env:NDK_HOME
if (-not $ndkHome) {
    $ndkHome = [Environment]::GetEnvironmentVariable('NDK_HOME', 'User')
}
$ndkProperties = if ($ndkHome) { Join-Path $ndkHome 'source.properties' } else { $null }
$ndkRevisionLine = if ($ndkProperties -and (Test-Path -LiteralPath $ndkProperties)) {
    (Get-Content -LiteralPath $ndkProperties | Where-Object { $_ -match '^Pkg\.Revision' }) -join '; '
} else {
    $null
}
$ndkRevisionValid = [bool]$ndkRevisionLine -and $ndkRevisionLine -match '^Pkg\.Revision\s*=\s*\d+(\.\d+){2,3}$'
$ndkDetail = if ($ndkRevisionLine) { $ndkRevisionLine } else { 'NDK_HOME is not configured or source.properties is missing' }
if ($ndkRevisionLine -and -not $ndkRevisionValid) { $ndkDetail = "$ndkDetail; invalid NDK revision" }
Add-Check -Area 'Android' -Name 'NDK' -Passed $ndkRevisionValid -Detail $ndkDetail

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

$androidStudioHome = $env:ANDROID_STUDIO_HOME
if (-not $androidStudioHome) {
    $androidStudioHome = [Environment]::GetEnvironmentVariable('ANDROID_STUDIO_HOME', 'User')
}
$androidStudioCandidates = if ($androidStudioHome) {
    @((Join-Path $androidStudioHome 'bin\studio64.exe'))
} else {
    @(
        'D:\Android\Android_Studio_Setup\bin\studio64.exe',
        (Join-Path $env:ProgramFiles 'Android\Android Studio\bin\studio64.exe')
    )
}
$androidStudio = $androidStudioCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
Add-Check -Area 'Android' -Name 'Android Studio' -Passed ([bool]$androidStudio) -Detail $(if ($androidStudio) { $androidStudio } else { 'Android Studio not found' })

$devEcoHome = $env:DEVECO_STUDIO_HOME
if (-not $devEcoHome) {
    $devEcoHome = [Environment]::GetEnvironmentVariable('DEVECO_STUDIO_HOME', 'User')
}
if (-not $devEcoHome) {
    $devEcoBin = [Environment]::GetEnvironmentVariable('DevEco Studio', 'Process')
    if ($devEcoBin) {
        $devEcoHome = Split-Path -Parent $devEcoBin.TrimEnd(';', '\')
    }
}
if (-not $devEcoHome) {
    $devEcoHome = @(
        'D:\Deveco_Studio\DevEco Studio',
        (Join-Path $env:ProgramFiles 'Huawei\DevEco Studio')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
$devEcoHomeValid = [bool]$devEcoHome -and (Test-Path -LiteralPath $devEcoHome)

$productInfoPath = if ($devEcoHomeValid) { Join-Path $devEcoHome 'product-info.json' } else { $null }
$devEcoVersion = if ($productInfoPath -and (Test-Path -LiteralPath $productInfoPath)) { (Get-Content -Raw -LiteralPath $productInfoPath | ConvertFrom-Json).version } else { 'Not found' }
Add-Check -Area 'HarmonyOS' -Name 'DevEco Studio' -Passed $devEcoHomeValid -Detail $(if ($devEcoHome) { "$devEcoVersion at $devEcoHome" } else { 'DevEco Studio not found' })

$sdkPackage = $null
$sdkDetail = if ($devEcoHomeValid) { 'sdk-pkg.json missing' } else { 'Skipped because DevEco Studio is invalid' }
$sdkPassed = $false
$ohpmProbe = $null
$hvigorProbe = $null
$hdcProbe = $null
if ($devEcoHomeValid) {
    $sdkPackage = Join-Path $devEcoHome 'sdk\default\sdk-pkg.json'
    $ohpm = Join-Path $devEcoHome 'tools\ohpm\bin\ohpm.bat'
    $hvigor = Join-Path $devEcoHome 'tools\hvigor\bin\hvigorw.bat'
    $hdc = Join-Path $devEcoHome 'sdk\default\openharmony\toolchains\hdc.exe'
    if (Test-Path -LiteralPath $sdkPackage) {
        $sdk = Get-Content -Raw -LiteralPath $sdkPackage | ConvertFrom-Json
        $sdkPassed = [int]$sdk.data.apiVersion -ge 12
        $sdkDetail = "$($sdk.data.displayName), API $($sdk.data.apiVersion), $($sdk.data.version)"
        if (-not $sdkPassed) { $sdkDetail = "$sdkDetail; requires API 12 or newer" }
    }

    $ohpmProbe = if (Test-Path -LiteralPath $ohpm) { Invoke-CommandProbe { & $ohpm --version } } else { $null }
    $hvigorProbe = if (Test-Path -LiteralPath $hvigor) { Invoke-CommandProbe { & $hvigor --version } } else { $null }
    $hdcProbe = if (Test-Path -LiteralPath $hdc) { Invoke-CommandProbe { & $hdc version } } else { $null }
}

Add-Check -Area 'HarmonyOS' -Name 'HarmonyOS SDK' -Passed $sdkPassed -Detail $sdkDetail
Add-Check -Area 'HarmonyOS' -Name 'ohpm' -Passed ([bool]$ohpmProbe -and $ohpmProbe.Passed) -Detail $(if ($ohpmProbe) { $ohpmProbe.Detail } elseif ($devEcoHomeValid) { 'ohpm.bat missing' } else { 'Skipped because DevEco Studio is invalid' })
Add-Check -Area 'HarmonyOS' -Name 'hvigor' -Passed ([bool]$hvigorProbe -and $hvigorProbe.Passed) -Detail $(if ($hvigorProbe) { $hvigorProbe.Detail } elseif ($devEcoHomeValid) { 'hvigorw.bat missing' } else { 'Skipped because DevEco Studio is invalid' })
Add-Check -Area 'HarmonyOS' -Name 'hdc' -Passed ([bool]$hdcProbe -and $hdcProbe.Passed) -Detail $(if ($hdcProbe) { $hdcProbe.Detail } elseif ($devEcoHomeValid) { 'hdc.exe missing' } else { 'Skipped because DevEco Studio is invalid' })

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
