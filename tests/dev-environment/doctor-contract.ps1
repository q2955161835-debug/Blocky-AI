[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$doctorPath = (Resolve-Path (Join-Path $repositoryRoot 'scripts\check-dev-environment.ps1')).Path
$loaderPath = (Resolve-Path (Join-Path $repositoryRoot 'scripts\use-dev-environment.ps1')).Path
$failingBinPath = (Resolve-Path (Join-Path $PSScriptRoot 'fixtures\failing-bin')).Path
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$failures = [System.Collections.Generic.List[string]]::new()

function Invoke-IsolatedPowerShell {
    param(
        [Parameter(Mandatory)][string]$Code,
        [hashtable]$Environment = @{}
    )

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code))
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pwshPath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.ArgumentList.Add('-NoProfile')
    $startInfo.ArgumentList.Add('-EncodedCommand')
    $startInfo.ArgumentList.Add($encoded)

    foreach ($entry in $Environment.GetEnumerator()) {
        $startInfo.Environment[$entry.Key] = [string]$entry.Value
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout   = $stdout.Trim()
        Stderr   = $stderr.Trim()
    }
}

function Convert-DoctorResult {
    param(
        [Parameter(Mandatory)]$ProcessResult,
        [Parameter(Mandatory)][string]$Scenario
    )

    try {
        return $ProcessResult.Stdout | ConvertFrom-Json
    }
    catch {
        $failures.Add("$Scenario did not emit valid JSON: $($ProcessResult.Stdout)")
        return $null
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory)][AllowNull()][AllowEmptyString()]$Actual,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)][string]$Message
    )

    if ($Actual -ne $Expected) {
        $failures.Add("$Message (expected=$Expected, actual=$Actual)")
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Actual,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Message
    )

    if (-not $Actual.Contains($Expected, [StringComparison]::OrdinalIgnoreCase)) {
        $failures.Add("$Message (expected fragment=$Expected, actual=$Actual)")
    }
}

$quotedDoctor = $doctorPath.Replace("'", "''")
$quotedLoader = $loaderPath.Replace("'", "''")
$doctorCommand = "& '$quotedDoctor' -Json"

$healthyProcess = Invoke-IsolatedPowerShell -Code $doctorCommand
$healthy = Convert-DoctorResult -ProcessResult $healthyProcess -Scenario 'healthy doctor'
Assert-Equal -Actual $healthyProcess.ExitCode -Expected 0 -Message 'healthy doctor exits successfully'
if ($healthy) {
    Assert-Equal -Actual $healthy.checks.Count -Expected 26 -Message 'healthy doctor emits the stable 26-check contract'
    Assert-Equal -Actual $healthy.failed -Expected 0 -Message 'healthy doctor has no failures'
}

$invalidAndroidProcess = Invoke-IsolatedPowerShell -Code $doctorCommand -Environment @{
    ANDROID_HOME = 'Z:\Blocky-Missing-Android-SDK'
}
$invalidAndroid = Convert-DoctorResult -ProcessResult $invalidAndroidProcess -Scenario 'invalid ANDROID_HOME'
Assert-Equal -Actual $invalidAndroidProcess.ExitCode -Expected 1 -Message 'invalid ANDROID_HOME exits with failure'
if ($invalidAndroid) {
    Assert-Equal -Actual $invalidAndroid.checks.Count -Expected 26 -Message 'invalid ANDROID_HOME still emits all checks'
    $androidChecks = @($invalidAndroid.checks | Where-Object { $_.check -in @('ANDROID_HOME', 'adb', 'SDK Platform', 'Build Tools', 'Command-line Tools') })
    Assert-Equal -Actual @($androidChecks | Where-Object { $_.status -eq 'FAIL' }).Count -Expected 5 -Message 'invalid ANDROID_HOME fails all dependent Android checks'
}

$invalidDevEcoProcess = Invoke-IsolatedPowerShell -Code $doctorCommand -Environment @{
    DEVECO_STUDIO_HOME = 'Z:\Blocky-Missing-DevEco-Studio'
}
$invalidDevEco = Convert-DoctorResult -ProcessResult $invalidDevEcoProcess -Scenario 'invalid DEVECO_STUDIO_HOME'
Assert-Equal -Actual $invalidDevEcoProcess.ExitCode -Expected 1 -Message 'invalid DEVECO_STUDIO_HOME exits with failure'
if ($invalidDevEco) {
    Assert-Equal -Actual $invalidDevEco.checks.Count -Expected 26 -Message 'invalid DEVECO_STUDIO_HOME still emits all checks'
    $harmonyChecks = @($invalidDevEco.checks | Where-Object { $_.area -eq 'HarmonyOS' })
    Assert-Equal -Actual @($harmonyChecks | Where-Object { $_.status -eq 'FAIL' }).Count -Expected 5 -Message 'invalid DEVECO_STUDIO_HOME fails all HarmonyOS checks'
}

$failingGitProcess = Invoke-IsolatedPowerShell -Code $doctorCommand -Environment @{
    PATH = "$failingBinPath;$env:PATH"
}
$failingGit = Convert-DoctorResult -ProcessResult $failingGitProcess -Scenario 'failing git command'
Assert-Equal -Actual $failingGitProcess.ExitCode -Expected 1 -Message 'a failing version command makes doctor fail'
if ($failingGit) {
    $gitCheck = $failingGit.checks | Where-Object { $_.check -eq 'git' }
    Assert-Equal -Actual $gitCheck.status -Expected 'FAIL' -Message 'a failing git command is not reported as PASS'
}

$oldJavaCommand = @"
function global:java { Write-Output 'openjdk version "11.0.24"'; `$global:LASTEXITCODE = 0 }
& '$quotedDoctor' -Json
"@
$oldJavaProcess = Invoke-IsolatedPowerShell -Code $oldJavaCommand
$oldJava = Convert-DoctorResult -ProcessResult $oldJavaProcess -Scenario 'Java 11'
Assert-Equal -Actual $oldJavaProcess.ExitCode -Expected 1 -Message 'Java below 17 makes doctor fail'
if ($oldJava) {
    $javaCheck = $oldJava.checks | Where-Object { $_.check -eq 'java' }
    Assert-Equal -Actual $javaCheck.status -Expected 'FAIL' -Message 'Java below 17 is rejected'
}

$loaderCommand = @"
. '$quotedLoader' 6>`$null
[pscustomobject]@{
    android = `$env:ANDROID_HOME
    ndk = `$env:NDK_HOME
    deveco = `$env:DEVECO_STUDIO_HOME
} | ConvertTo-Json -Compress
"@
$processAndroid = 'D:\Android\.'
$processNdk = 'D:\Android\ndk\29.0.14206865\.'
$processDevEco = 'D:\Deveco_Studio\DevEco Studio\.'
$loaderProcess = Invoke-IsolatedPowerShell -Code $loaderCommand -Environment @{
    ANDROID_HOME = $processAndroid
    NDK_HOME = $processNdk
    DEVECO_STUDIO_HOME = $processDevEco
}
Assert-Equal -Actual $loaderProcess.ExitCode -Expected 0 -Message 'loader accepts valid process-scoped paths'
try {
    $loaderResult = $loaderProcess.Stdout | ConvertFrom-Json
    Assert-Equal -Actual $loaderResult.android -Expected $processAndroid -Message 'loader honors process ANDROID_HOME before user configuration'
    Assert-Equal -Actual $loaderResult.ndk -Expected $processNdk -Message 'loader honors process NDK_HOME before user configuration'
    Assert-Equal -Actual $loaderResult.deveco -Expected $processDevEco -Message 'loader honors process DEVECO_STUDIO_HOME before user configuration'
}
catch {
    $failures.Add("loader did not emit valid JSON: $($loaderProcess.Stdout); stderr=$($loaderProcess.Stderr)")
}

$missingNdkProcess = Invoke-IsolatedPowerShell -Code $loaderCommand -Environment @{
    ANDROID_HOME = $repositoryRoot
    NDK_HOME = 'Z:\Blocky-Missing-Android-NDK'
    DEVECO_STUDIO_HOME = 'D:\Deveco_Studio\DevEco Studio'
}
Assert-Equal -Actual $missingNdkProcess.ExitCode -Expected 1 -Message 'loader fails when the selected SDK has no NDK'
Assert-Contains -Actual $missingNdkProcess.Stderr -Expected 'no side-by-side NDK was found' -Message 'loader reports an actionable missing NDK error'

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) {
        Write-Host "FAIL: $failure"
    }
    Write-Host "Result: $($failures.Count) contract assertions failed."
    exit 1
}

Write-Host 'PASS: development environment contract tests passed.'
exit 0
