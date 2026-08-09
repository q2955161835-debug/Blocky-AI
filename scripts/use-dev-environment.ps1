[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-PathEntry {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $entries = $env:Path -split ';' | Where-Object { $_ }
    if ($entries -notcontains $Path) {
        $env:Path = "$Path;$env:Path"
    }
}

$androidHome = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User')
if (-not $androidHome -and (Test-Path -LiteralPath 'D:\Android')) {
    $androidHome = 'D:\Android'
}
if (-not $androidHome -or -not (Test-Path -LiteralPath $androidHome)) {
    throw 'ANDROID_HOME is not configured or does not exist.'
}

$ndkHome = [Environment]::GetEnvironmentVariable('NDK_HOME', 'User')
if (-not $ndkHome -or -not (Test-Path -LiteralPath $ndkHome)) {
    $ndkRoot = Join-Path $androidHome 'ndk'
    $ndkHome = Get-ChildItem -LiteralPath $ndkRoot -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ndkHome -or -not (Test-Path -LiteralPath $ndkHome)) {
    throw 'NDK_HOME is not configured and no side-by-side NDK was found.'
}

$devEcoHome = [Environment]::GetEnvironmentVariable('DEVECO_STUDIO_HOME', 'User')
if (-not $devEcoHome) {
    $devEcoBin = [Environment]::GetEnvironmentVariable('DevEco Studio', 'Process')
    if ($devEcoBin) {
        $devEcoBin = $devEcoBin.TrimEnd(';', '\')
        $devEcoHome = Split-Path -Parent $devEcoBin
    }
}
if (-not $devEcoHome -and (Test-Path -LiteralPath 'D:\Deveco_Studio\DevEco Studio')) {
    $devEcoHome = 'D:\Deveco_Studio\DevEco Studio'
}
if (-not $devEcoHome -or -not (Test-Path -LiteralPath $devEcoHome)) {
    throw 'DevEco Studio was not found. Set the user variable DEVECO_STUDIO_HOME.'
}

$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:NDK_HOME = $ndkHome
$env:DEVECO_STUDIO_HOME = $devEcoHome

$pathEntries = @(
    (Join-Path $androidHome 'platform-tools'),
    (Join-Path $androidHome 'cmdline-tools\latest\bin'),
    (Join-Path $devEcoHome 'bin'),
    (Join-Path $devEcoHome 'tools\ohpm\bin'),
    (Join-Path $devEcoHome 'tools\hvigor\bin'),
    (Join-Path $devEcoHome 'sdk\default\openharmony\toolchains')
)

foreach ($entry in $pathEntries) {
    Add-PathEntry -Path $entry
}

Write-Host 'Blocky development environment loaded into the current PowerShell session.'
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "NDK_HOME=$env:NDK_HOME"
Write-Host "DEVECO_STUDIO_HOME=$env:DEVECO_STUDIO_HOME"
