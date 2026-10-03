param(
 [Parameter(Mandatory=$true)][string]$Document,
 [string]$LibreOfficeRuntime,
 [string]$Profile,
 [ValidateSet("Auto","Word","LibreOffice")][string]$Engine="Auto"
)
$ErrorActionPreference='Stop'
$taskDoc=(Resolve-Path -LiteralPath $Document).Path
if($Engine -eq 'Word' -or ($Engine -eq 'Auto' -and !$LibreOfficeRuntime)){
 $taskWord=$null;$taskOpen=$null
 try {
  $taskWord=New-Object -ComObject Word.Application
  $taskWord.Visible=$false;$taskWord.DisplayAlerts=0;$taskWord.AutomationSecurity=3
  $taskOpen=$taskWord.Documents.Open($taskDoc,$false,$true,$false)
  $taskOpen.Repaginate()
  $taskOpen.ExportAsFixedFormat([IO.Path]::ChangeExtension($taskDoc,'.pdf'),17,$false,0,0,1,1,0,$false,$false,1,$true,$true,$false)
 } finally {
  if($taskOpen){$taskOpen.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskOpen)}
  if($taskWord){$taskWord.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord)}
  [GC]::Collect();[GC]::WaitForPendingFinalizers()
 }
 return
}
if(!$LibreOfficeRuntime -or !$Profile){throw 'LibreOffice export requires an existing runtime and isolated profile'}
$taskRuntime=(Resolve-Path -LiteralPath $LibreOfficeRuntime).Path
$taskProfile=[IO.Path]::GetFullPath($Profile)
$taskOutput=[IO.Path]::GetDirectoryName($taskDoc)
$taskProfileUri=([Uri]$taskProfile).AbsoluteUri
$taskExe=Join-Path $taskRuntime 'program\soffice.com'
if(!(Test-Path -LiteralPath $taskExe)){throw 'Project LibreOffice runtime is unavailable'}
# Use installed static fonts in this isolated runtime; the machine variable font
# resolves to Thin in Writer and must not silently change the document weight.
$taskFontDir=Join-Path $taskRuntime 'share\fonts\truetype'
New-Item -ItemType Directory -Force -Path $taskFontDir | Out-Null
foreach($taskPair in @(
 @('C:\Windows\Fonts\Noto Sans SC (TrueType).otf','NotoSansSC-Regular.otf'),
 @('C:\Windows\Fonts\Noto Sans SC Bold (TrueType).otf','NotoSansSC-Bold.otf')
)){
 if(!(Test-Path -LiteralPath $taskPair[0])){throw "Required installed static font is unavailable: $($taskPair[0])"}
 Copy-Item -LiteralPath $taskPair[0] -Destination (Join-Path $taskFontDir $taskPair[1]) -Force
}
& $taskExe "-env:UserInstallation=$taskProfileUri" --headless --convert-to pdf --outdir $taskOutput $taskDoc
if($LASTEXITCODE -ne 0){throw "PDF export failed: $LASTEXITCODE"}
