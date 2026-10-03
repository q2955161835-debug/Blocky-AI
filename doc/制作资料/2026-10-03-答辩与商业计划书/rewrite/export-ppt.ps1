param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
$taskPpt=[IO.Path]::GetFullPath($Path)
$taskPdf=[IO.Path]::ChangeExtension($taskPpt,'.pdf')
$taskApp=$null
$taskDeck=$null
try {
  $taskApp=New-Object -ComObject PowerPoint.Application
  $taskDeck=$taskApp.Presentations.Open($taskPpt,-1,0,0)
  $taskPages=$taskDeck.Slides.Count
  $taskDeck.SaveAs($taskPdf,32)
  Write-Output "Native PowerPoint export: $taskPages pages; $taskPdf"
} finally {
  if($taskDeck){$taskDeck.Close();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDeck)}
  if($taskApp){$taskApp.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskApp)}
}
