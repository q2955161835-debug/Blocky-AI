param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
 $entry=$zip.GetEntry('bin/x64-win/DirectML.dll')
 if($null -eq $entry){throw 'Locked DirectML archive entry is missing'}
 [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$Destination,$false)
} finally {$zip.Dispose()}
