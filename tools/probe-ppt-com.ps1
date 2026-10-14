# tools/probe-ppt-com.ps1 — 用 PowerPoint COM 一次导出整本幻灯片为 PNG
#
# 为什么试这条路：LibreOffice 的 PageRange 过滤器选项被忽略（实测：两次导出哈希相同），
# 所以它「每次进程只能出第 1 页」。而 PowerPoint 的 COM 接口可以在**一次调用**里
# 把整本导出成 PNG —— 12 页从「每页一个进程」变成「一次调用」。
#
# 用法：pwsh -File tools/probe-ppt-com.ps1 <deck.pptx> <outDir>

param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$deckPath = (Resolve-Path $Deck).Path
$outPath = (Resolve-Path $OutDir).Path

Write-Output "deck : $deckPath"
Write-Output "out  : $outPath"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$ppt = $null
$presentation = $null
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  # WithWindow=$false 让它不弹窗；PowerPoint 有时仍会要求可见，失败则回退可见。
  try { $ppt.Visible = $false } catch { }

  # ReadOnly + Untitled=$false：全程不改动原文件
  $presentation = $ppt.Presentations.Open($deckPath, $true, $false, $false)
  $count = $presentation.Slides.Count
  Write-Output "slides: $count"

  # 一次调用导出整本，宽度 1920（高度按比例）
  $presentation.Export($outPath, 'PNG', 1920, 1080)
  $sw.Stop()
  Write-Output ("elapsed: {0:N1}s" -f $sw.Elapsed.TotalSeconds)

  $files = Get-ChildItem $outPath -Filter *.PNG -ErrorAction SilentlyContinue
  if ($files.Count -eq 0) { $files = Get-ChildItem $outPath -Filter *.png -ErrorAction SilentlyContinue }
  Write-Output "exported: $($files.Count) file(s)"
  foreach ($f in $files | Select-Object -First 5) { Write-Output ("  {0,9} bytes  {1}" -f $f.Length, $f.Name) }
} catch {
  $sw.Stop()
  Write-Output "COM FAILED: $($_.Exception.GetType().Name): $($_.Exception.Message)"
  exit 1
} finally {
  if ($presentation -ne $null) { try { $presentation.Close() } catch { } }
  if ($ppt -ne $null) { try { $ppt.Quit() } catch { } }
  foreach ($obj in @($presentation, $ppt)) {
    if ($obj -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { } }
  }
}
