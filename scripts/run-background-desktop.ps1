# Development harness only. Start owned UI and runners on a non-input desktop.
# No SwitchDesktop, foreground activation, SendInput, clipboard or desktop capture.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$Application,
 [string[]]$Arguments=@(),
 [Parameter(Mandatory)][string]$RunDirectory,
 [ValidateRange(10,3600)][int]$TimeoutSeconds=2400,
 [hashtable]$ChildEnvironment=@{},
 [string]$ControllerScript,
 [ValidateRange(0,65535)][int]$CdpPort=0
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$applicationPath=(Resolve-Path -LiteralPath $Application).Path
$runPath=[IO.Path]::GetFullPath($RunDirectory,$taskRoot)
$tryPrefix=[IO.Path]::GetFullPath((Join-Path $taskRoot 'try')).TrimEnd('\')+'\'
if(-not $runPath.StartsWith($tryPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'RunDirectory must be under project try/'}
if(Test-Path -LiteralPath (Join-Path $runPath 'background-result.json')){throw 'Do not overwrite completed run evidence'}
if($ControllerScript){$ControllerScript=(Resolve-Path -LiteralPath $ControllerScript).Path;if(-not $ControllerScript.StartsWith($taskRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Controller must be a project-owned script'}}
[IO.Directory]::CreateDirectory($runPath)|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $runPath 'profile'))|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $runPath 'temp'))|Out-Null
$previousTemp=$env:TEMP;$previousTmp=$env:TMP
$env:TEMP=Join-Path $runPath 'temp';$env:TMP=$env:TEMP
$desktop=[IntPtr]::Zero;$job=[IntPtr]::Zero
$processes=[Collections.Generic.List[object]]::new()
$receipt=[ordered]@{schemaVersion='blocky.background-ui/v1';startedAt=[DateTime]::UtcNow.ToString('o');application=[IO.Path]::GetFileName($applicationPath);runDirectory=$runPath;timeoutSeconds=$TimeoutSeconds;focusViolation=$false}
function Start-OwnedProcess([string]$exe,[string[]]$argv,[string]$role){
 $si=New-Object BlockyBackgroundDesktop+SI;$si.cb=[Runtime.InteropServices.Marshal]::SizeOf($si);$si.desktop="WinSta0\$desktopName"
 $pi=New-Object BlockyBackgroundDesktop+PI
 $command=[Text.StringBuilder]::new(([BlockyBackgroundDesktop]::QuoteArgument($exe)+' '+(($argv|ForEach-Object{[BlockyBackgroundDesktop]::QuoteArgument($_)})-join ' ')))
 if(-not [BlockyBackgroundDesktop]::CreateProcessW($exe,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08000404,$environmentPtr,$taskRoot,[ref]$si,[ref]$pi)){throw [ComponentModel.Win32Exception]::new()}
 $processes.Add([pscustomobject]@{role=$role;info=$pi})
 if(-not [BlockyBackgroundDesktop]::AssignProcessToJobObject($job,$pi.process)){throw [ComponentModel.Win32Exception]::new()}
 if([BlockyBackgroundDesktop]::ResumeThread($pi.thread)-eq [uint32]::MaxValue){throw [ComponentModel.Win32Exception]::new()}
 return $pi
}
function Observe-InputDesktop {
 $fg=[BlockyBackgroundDesktop]::GetForegroundWindow();$foregroundPid=[uint32]0
 [void][BlockyBackgroundDesktop]::GetWindowThreadProcessId($fg,[ref]$foregroundPid)
 $own=[BlockyBackgroundDesktop]::JobPids($job)
 $sample=[ordered]@{elapsedSeconds=[int]([DateTime]::UtcNow-$started).TotalSeconds;foregroundIsOwned=($foregroundPid-ne 0 -and $own-contains $foregroundPid);ownedProcessCount=$own.Count}
 if($sample.foregroundIsOwned){$receipt.focusViolation=$true;throw 'Owned test process reached foreground input desktop'}
 $sample|ConvertTo-Json -Compress|Add-Content -LiteralPath (Join-Path $runPath 'background-observations.jsonl')
}
try {
 Add-Type -Path (Join-Path $PSScriptRoot 'BackgroundDesktop.cs')
 $receipt.foregroundBefore=[BlockyBackgroundDesktop]::GetForegroundWindow().ToInt64()
 $receipt.callerDesktop=[BlockyBackgroundDesktop]::DesktopName([BlockyBackgroundDesktop]::GetThreadDesktop([BlockyBackgroundDesktop]::GetCurrentThreadId()))
 $desktopName='BlockyTest-'+[Guid]::NewGuid().ToString('N');$receipt.desktop=$desktopName
 $desktop=[BlockyBackgroundDesktop]::CreateDesktopW($desktopName,[IntPtr]::Zero,[IntPtr]::Zero,0,0x1ff,[IntPtr]::Zero)
 if($desktop-eq [IntPtr]::Zero){throw [ComponentModel.Win32Exception]::new()}
 $job=[BlockyBackgroundDesktop]::KillOnCloseJob()
 $map=[Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
 [Environment]::GetEnvironmentVariables().GetEnumerator()|ForEach-Object{$map[$_.Key]=$_.Value}
 foreach($key in $ChildEnvironment.Keys){if($key-match '[=\x00]' -or [string]$ChildEnvironment[$key]-match '\x00'){throw 'Invalid child environment'};$map[$key]=[string]$ChildEnvironment[$key]}
 $map['BLOCKY_PROFILE_DIR']=Join-Path $runPath 'profile';$map['BLOCKY_BACKGROUND_DESKTOP']=$desktopName
 if($CdpPort){if(Get-NetTCPConnection -LocalPort $CdpPort -State Listen -ErrorAction SilentlyContinue){throw 'Requested CDP port already used'};$map['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']="--remote-debugging-port=$CdpPort --remote-debugging-address=127.0.0.1";$map['BLOCKY_BACKGROUND_CDP_PORT']=[string]$CdpPort}
 $block=(($map.GetEnumerator()|ForEach-Object{"$($_.Key)=$($_.Value)"})-join "`0")+"`0`0"
 $environmentPtr=[Runtime.InteropServices.Marshal]::StringToHGlobalUni($block)
 try {
  $started=[DateTime]::UtcNow
  $main=Start-OwnedProcess $applicationPath $Arguments 'application';$receipt.pid=$main.pid
  @{pid=$main.pid;desktop=$desktopName;application=$applicationPath;startedAt=$started.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runPath 'background-start.json')
  Write-Output ('BLOCKY_BACKGROUND_STARTED '+(@{pid=$main.pid;desktop=$desktopName;runDirectory=$runPath}|ConvertTo-Json -Compress))
  $waitTarget=$main
  if($ControllerScript){
   if(-not $CdpPort){throw 'Controller requires an explicit loopback CDP port'}
   $ready=$false
   for($i=0;$i-lt 40;$i++){Observe-InputDesktop;try{if(Invoke-RestMethod "http://127.0.0.1:$CdpPort/json/list" -TimeoutSec 1){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 500}
   if(-not $ready){throw 'Owned WebView CDP unavailable'}
   $listeners=Get-NetTCPConnection -LocalPort $CdpPort -State Listen
   $own=[BlockyBackgroundDesktop]::JobPids($job)
   if(@($listeners|Where-Object{$_.LocalAddress-notin @('127.0.0.1','::1') -or $own-notcontains $_.OwningProcess}).Count){throw 'CDP listener must be loopback and job-owned'}
   $receipt.cdpPort=$CdpPort
   $nodePath=(Get-Command node -CommandType Application | Select-Object -First 1).Source
   $waitTarget=Start-OwnedProcess $nodePath @($ControllerScript,[string]$CdpPort,$runPath) 'controller'
  }
  while([BlockyBackgroundDesktop]::WaitForSingleObject($waitTarget.process,1000)-eq 258){Observe-InputDesktop;if(([DateTime]::UtcNow-$started).TotalSeconds-ge $TimeoutSeconds){throw 'Background run timed out'}}
  $exitCode=[uint32]0;if(-not [BlockyBackgroundDesktop]::GetExitCodeProcess($waitTarget.process,[ref]$exitCode)){throw [ComponentModel.Win32Exception]::new()}
  $receipt.controllerOrRunnerExitCode=$exitCode
  $receipt.applicationExitedNaturally=([BlockyBackgroundDesktop]::WaitForSingleObject($main.process,0)-eq 0)
  $receipt.ownedWindowsBeforeCleanup=@([BlockyBackgroundDesktop]::JobPids($job)|ForEach-Object{[BlockyBackgroundDesktop]::OwnWindows($desktop,$_ )})
  if($exitCode-ne 0){throw "Background controller/runner exited $exitCode"}
 }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($environmentPtr)}
}catch{$receipt.error=$_.Exception.Message;throw}
finally{
 if($job-ne [IntPtr]::Zero){$receipt.jobHandleClosed=[BlockyBackgroundDesktop]::CloseHandle($job);Start-Sleep -Seconds 2}
 $receipt.processes=@(foreach($item in $processes){$pi=$item.info;$ended=([BlockyBackgroundDesktop]::WaitForSingleObject($pi.process,0)-eq 0);if(-not $ended){[void][BlockyBackgroundDesktop]::TerminateProcess($pi.process,3);[void][BlockyBackgroundDesktop]::WaitForSingleObject($pi.process,5000);$ended=([BlockyBackgroundDesktop]::WaitForSingleObject($pi.process,0)-eq 0)};@{role=$item.role;pid=$pi.pid;exited=$ended;threadHandleClosed=[BlockyBackgroundDesktop]::CloseHandle($pi.thread);processHandleClosed=[BlockyBackgroundDesktop]::CloseHandle($pi.process)}})
 if($desktop-ne [IntPtr]::Zero){$receipt.desktopHandleClosed=[BlockyBackgroundDesktop]::CloseDesktop($desktop)}
 if($CdpPort){$receipt.cdpPortClosed=(-not [bool](Get-NetTCPConnection -LocalPort $CdpPort -State Listen -ErrorAction SilentlyContinue))}
 if('BlockyBackgroundDesktop'-as [type]){$receipt.foregroundFinally=[BlockyBackgroundDesktop]::GetForegroundWindow().ToInt64()}
 $receipt.endedAt=[DateTime]::UtcNow.ToString('o')
 $receipt|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $runPath 'background-result.json')
 $env:TEMP=$previousTemp;$env:TMP=$previousTmp
 Write-Output ($receipt|ConvertTo-Json -Depth 10)
}
