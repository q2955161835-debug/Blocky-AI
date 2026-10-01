# Invoke from a child of run-background-desktop.ps1 on its isolated desktop.
# All selectors, screenshots and actions are restricted to that application's PID.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$RunDirectory,
 [ValidateSet('inspect','capture','set-value','invoke','file-select','file-cancel')][string]$Action='inspect',
 [string]$AutomationId,
 [string]$Name,
 [string]$ControlType,
 [string]$Value,
 [ValidateRange(1,60)][int]$WaitSeconds=15,
 [string]$EvidenceName='native-dialog'
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$runPath=[IO.Path]::GetFullPath($(if([IO.Path]::IsPathRooted($RunDirectory)){$RunDirectory}else{Join-Path $taskRoot $RunDirectory}))
if(-not $runPath.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRoot 'try')).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Run directory must be project-owned'}
if($EvidenceName-notmatch '^[a-zA-Z0-9_-]+$'){throw 'Invalid evidence filename'}
$binding=Get-Content -LiteralPath (Join-Path $runPath 'background-start.json') -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'BackgroundDesktop.cs')
$currentDesktop=[BlockyBackgroundDesktop]::DesktopName([BlockyBackgroundDesktop]::GetThreadDesktop([BlockyBackgroundDesktop]::GetCurrentThreadId()))
if($currentDesktop-ne $binding.desktop -or $currentDesktop-notmatch '^BlockyTest-[0-9a-f]{32}$'){throw 'Native driver is not on its bound background desktop'}
if($Action-in @('set-value','invoke') -and -not ($AutomationId-or $Name)){throw 'An exact selector is required'}
if($Value-match 'sk-[a-zA-Z0-9_-]{20,}' -or $Name-match '\u5bc6\u7801|\u5bc6\u94a5|Cookie|Token'){throw 'Credentials are excluded from this test driver'}
if($Action-eq 'file-select'){
 $testPath=[IO.Path]::GetFullPath($Value)
 if(-not $testPath.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRoot 'try')).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Selected file must be in project try'}
 if($testPath-notmatch '\.blocky$'){throw 'Only project test .blocky files are allowed'}
 $pathToCheck=$testPath
 while($pathToCheck-and $pathToCheck.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRoot 'try')),[StringComparison]::OrdinalIgnoreCase)){
  if(Test-Path -LiteralPath $pathToCheck){if(((Get-Item -LiteralPath $pathToCheck -Force).Attributes-band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Reparse points are excluded from test file selection'}}
  $pathToCheck=[IO.Path]::GetDirectoryName($pathToCheck)
 }
 $Value=$testPath
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public class BoundNativeDialog {
 public delegate bool EnumFn(IntPtr hwnd,IntPtr state);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumFn callback,IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumFn callback,IntPtr state);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr window,uint msg,IntPtr wp,StringBuilder lp);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr window,uint msg,IntPtr wp,string lp);
 public class Control {public long hwnd,parent;public int id;public string cls,text;public bool enabled,visible;}
 public static Control[] Children(IntPtr root,uint pid){var found=new List<Control>();EnumFn callback=(h,s)=>{if(!Owned(h,pid))throw new InvalidOperationException("Child not owned");var c=new StringBuilder(256);GetClassNameW(h,c,256);var t=new StringBuilder(2048);SendMessageW(h,13,(IntPtr)2048,t);found.Add(new Control{hwnd=h.ToInt64(),parent=GetParent(h).ToInt64(),id=GetDlgCtrlID(h),cls=c.ToString(),text=t.ToString(),enabled=IsWindowEnabled(h),visible=IsWindowVisible(h)});return true;};EnumChildWindows(root,callback,IntPtr.Zero);return found.ToArray();}
 public static void SetText(IntPtr h,string value){if(SendMessageW(h,12,IntPtr.Zero,value)==IntPtr.Zero)throw new InvalidOperationException("WM_SETTEXT failed");}
 public static string Text(IntPtr h){var t=new StringBuilder(32768);SendMessageW(h,13,(IntPtr)32768,t);return t.ToString();}
 public static void Click(IntPtr h){SendMessageW(h,245,IntPtr.Zero,(string)null);}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 public static IntPtr[] Dialogs(uint pid){var found=new List<IntPtr>();EnumFn callback=(window,state)=>{uint owner;GetWindowThreadProcessId(window,out owner);var cls=new StringBuilder(256);GetClassNameW(window,cls,256);if(owner==pid&&IsWindowVisible(window)&&cls.ToString()=="#32770")found.Add(window);return true;};EnumWindows(callback,IntPtr.Zero);return found.ToArray();}
 public static bool Owned(IntPtr window,uint pid){uint owner;GetWindowThreadProcessId(window,out owner);return IsWindow(window)&&owner==pid;}
}
'@
$deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
do{
 $dialogs=@([BoundNativeDialog]::Dialogs([uint32]$binding.pid))
 if($dialogs.Count-eq 1){break}
 if($dialogs.Count-gt 1){throw 'Multiple owned dialogs require a narrower driver'}
 Start-Sleep -Milliseconds 250
}while([DateTime]::UtcNow-lt $deadline)
if($dialogs.Count-ne 1){throw 'No unique owned native file dialog'}
$window=$dialogs[0]
$root=[Windows.Automation.AutomationElement]::FromHandle($window)
$elements=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$controls=@(foreach($element in $elements){$current=$element.Current;@{automationId=$current.AutomationId;name=$current.Name;controlType=$current.ControlType.ProgrammaticName;password=$current.IsPassword;enabled=$current.IsEnabled;offscreen=$current.IsOffscreen;patterns=@($element.GetSupportedPatterns()|ForEach-Object{$_.ProgrammaticName})}})
$nativeControls=[BoundNativeDialog]::Children($window,[uint32]$binding.pid)
$receipt=[ordered]@{pid=$binding.pid;desktop=$currentDesktop;hwnd=$window.ToInt64();action=$Action;controls=$controls;nativeControls=$nativeControls;time=[DateTime]::UtcNow.ToString('o')}
if($Action-in @('file-select','file-cancel')){
 if(-not [BoundNativeDialog]::Owned($window,[uint32]$binding.pid)){throw 'Dialog ownership changed'}
 if($Action-eq 'file-select'){
  $comboRoots=@($nativeControls|Where-Object{$_.cls-eq 'ComboBoxEx32'-and $_.id-eq 1148-and $_.parent-eq $window.ToInt64()})
  if($comboRoots.Count-eq 1){
   $receipt.fileDialogSchema='open-comboboxex-1148'
   if(-not [IO.File]::Exists($Value)){throw 'Open file must already exist'}
   $combos=@($nativeControls|Where-Object{$_.cls-eq 'ComboBox'-and $_.id-eq 1148-and $_.parent-eq $comboRoots[0].hwnd})
   if($combos.Count-ne 1){throw 'No unique observed filename ComboBox 1148'}
   $edits=@($nativeControls|Where-Object{$_.cls-eq 'Edit'-and $_.id-eq 1148-and $_.parent-eq $combos[0].hwnd-and $_.enabled})
  }elseif($comboRoots.Count-eq 0){
   $receipt.fileDialogSchema='save-directui-edit-1001'
   if([IO.File]::Exists($Value)){throw 'Save test must use a new file; overwrite is excluded'}
   $views=@($nativeControls|Where-Object{$_.cls-eq 'DUIViewWndClassName'-and $_.parent-eq $window.ToInt64()})
   if($views.Count-ne 1){throw 'No unique save DirectUI view'}
   $direct=@($nativeControls|Where-Object{$_.cls-eq 'DirectUIHWND'-and $_.parent-eq $views[0].hwnd})
   if($direct.Count-ne 1){throw 'No unique save DirectUI child'}
   $sinks=@($nativeControls|Where-Object{$_.cls-eq 'FloatNotifySink'-and $_.parent-eq $direct[0].hwnd})
   $filenameParentIds=@($nativeControls|Where-Object{$_.cls-eq 'Edit'-and $_.id-eq 1001-and $_.enabled}|ForEach-Object{$_.parent})
   $combos=@($nativeControls|Where-Object{$_.cls-eq 'ComboBox'-and $_.id-eq 0-and @($sinks.hwnd)-contains $_.parent-and $filenameParentIds-contains $_.hwnd})
   if($combos.Count-ne 1){throw 'No unique save filename ComboBox under FloatNotifySink'}
   $edits=@($nativeControls|Where-Object{$_.cls-eq 'Edit'-and $_.id-eq 1001-and $_.parent-eq $combos[0].hwnd-and $_.enabled})
  }else{throw 'Multiple filename ComboBoxEx32 roots'}
  if($edits.Count-ne 1){throw 'No unique enabled filename Edit matching observed schema'}
  $edit=[IntPtr]$edits[0].hwnd
  if(-not [BoundNativeDialog]::Owned($edit,[uint32]$binding.pid)){throw 'Filename edit ownership changed'}
  [BoundNativeDialog]::SetText($edit,$Value)
  $receipt.valueReadBackMatches=([BoundNativeDialog]::Text($edit)-eq $Value)
  if(-not $receipt.valueReadBackMatches){throw 'Filename Win32 read-back mismatch'}
  $buttonId=1
 }else{$buttonId=2}
 $buttons=@($nativeControls|Where-Object{$_.cls-eq 'Button'-and $_.id-eq $buttonId-and $_.parent-eq $window.ToInt64()-and $_.enabled})
 if($buttons.Count-ne 1){throw 'No unique enabled dialog confirmation/cancel button'}
 if(-not [BoundNativeDialog]::Owned([IntPtr]$buttons[0].hwnd,[uint32]$binding.pid)){throw 'Button ownership changed'}
 [BoundNativeDialog]::Click([IntPtr]$buttons[0].hwnd)
 $receipt.clickedButtonId=$buttonId
 $closeDeadline=[DateTime]::UtcNow.AddSeconds(5)
 do{$stillThere=@([BoundNativeDialog]::Dialogs([uint32]$binding.pid)) -contains $window;if(-not $stillThere){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow-lt $closeDeadline)
 $receipt.dialogClosed=(-not $stillThere)
 if(-not $receipt.dialogClosed){throw 'File dialog did not close after owned button click'}
}
if($Action-in @('set-value','invoke')){
 $selected=@(foreach($element in $elements){$current=$element.Current;if((($AutomationId-and $current.AutomationId-eq $AutomationId)-or (-not $AutomationId-and $current.Name-eq $Name))-and (-not $ControlType-or $current.ControlType.ProgrammaticName-eq $ControlType)){$element}})
 if($selected.Count-ne 1){throw 'Selector must resolve one owned control'}
 if($selected[0].Current.ProcessId-ne $binding.pid -or $selected[0].Current.IsPassword -or -not $selected[0].Current.IsEnabled){throw 'Control cannot be used by this driver'}
 if(-not [BoundNativeDialog]::Owned($window,[uint32]$binding.pid)){throw 'Dialog ownership changed'}
 if($Action-eq 'set-value'){
  $pattern=$selected[0].GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  $pattern.SetValue($Value)
  $receipt.valueReadBackMatches=($pattern.Current.Value-eq $Value)
  if(-not $receipt.valueReadBackMatches){throw 'Native value read-back mismatch'}
 }else{
  $pattern=$selected[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke();$receipt.invoked=$true
 }
}
if($Action-in @('inspect','capture')){
 if(@($controls|Where-Object{$_.password-and -not $_.offscreen}).Count){throw 'Password control excludes unmasked native screenshot'}
 $rect=New-Object BoundNativeDialog+Rect
 if(-not [BoundNativeDialog]::GetWindowRect($window,[ref]$rect)){throw 'Native bounds unavailable'}
 $width=$rect.right-$rect.left;$height=$rect.bottom-$rect.top
 if($width-lt 1-or $height-lt 1-or $width-gt 2048-or $height-gt 2048){throw 'Native screenshot bounds exceeded'}
 $bitmap=New-Object Drawing.Bitmap $width,$height
 $graphics=$null
 try{
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $dc=$graphics.GetHdc()
  try{if(-not [BoundNativeDialog]::PrintWindow($window,$dc,2)){throw 'Owned PrintWindow failed'}}finally{$graphics.ReleaseHdc($dc)}
  if(-not [BoundNativeDialog]::Owned($window,[uint32]$binding.pid)){throw 'Native screenshot ownership changed'}
  $colors=@{};for($y=0;$y-lt $height;$y+=32){for($x=0;$x-lt $width;$x+=32){$colors[$bitmap.GetPixel($x,$y).ToArgb()]=$true}}
  if($colors.Count-lt 3){throw 'Native screenshot is blank or uniform'}
  $bitmap.Save((Join-Path $runPath ($EvidenceName+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  $receipt.screenshot=$EvidenceName+'.png';$receipt.sampledDistinctColors=$colors.Count
 }finally{if($graphics){$graphics.Dispose()};$bitmap.Dispose()}
}
[IO.File]::WriteAllText((Join-Path $runPath ($EvidenceName+'.json')),($receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$receipt|ConvertTo-Json -Depth 8
