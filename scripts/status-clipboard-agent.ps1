Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$pattern = "(?i)-File\s+.*clipboard-auto-tag\.ps1"
$targets = @(Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -like "powershell*" -and
    $_.CommandLine -and
    $_.CommandLine -match $pattern
  })

if (-not $targets) {
  Write-Output "Clipboard agent status: stopped"
  exit 1
}

Write-Output ("Clipboard agent status: running ({0} process)" -f $targets.Count)
foreach ($proc in $targets) {
  Write-Output ("- PID {0}" -f $proc.ProcessId)
}

$clipDir = Join-Path (Split-Path $PSScriptRoot -Parent) "tmp\clipboard"
if (Test-Path $clipDir) {
  $latest = Get-ChildItem -Path $clipDir -File -Filter "screenshot-*.png" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) {
    Write-Output ("Latest screenshot: {0} ({1})" -f $latest.Name, $latest.LastWriteTime)
  }
}
