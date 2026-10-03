param([Parameter(Mandatory=$true)][string]$Path,[string]$Pdf)
$ErrorActionPreference='Stop'
$taskPath=(Resolve-Path -LiteralPath $Path).Path
$taskExcel=$null;$taskBook=$null
try{
 $taskExcel=New-Object -ComObject Excel.Application
 $taskExcel.Visible=$false;$taskExcel.DisplayAlerts=$false;$taskExcel.AutomationSecurity=3
 $taskBook=$taskExcel.Workbooks.Open($taskPath,0,$false)
 $taskExcel.CalculateFullRebuild()
 $taskBook.Save()
 if($Pdf){$taskBook.ExportAsFixedFormat(0,[IO.Path]::GetFullPath($Pdf))}
}finally{
 if($taskBook){$taskBook.Close($false);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskBook)|Out-Null}
 if($taskExcel){$taskExcel.Quit();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskExcel)|Out-Null}
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
