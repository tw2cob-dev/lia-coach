Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$pattern = "(?i)-File\s+.*clipboard-auto-tag\.ps1"
$targets = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -like "powershell*" -and
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    $_.CommandLine -match $pattern
  }

if (-not $targets) {
  Write-Output "Clipboard agent is not running."
  exit 0
}

$stopped = 0
foreach ($proc in $targets) {
  Stop-Process -Id $proc.ProcessId -Force
  $stopped += 1
}

Write-Output "Clipboard agent stopped ($stopped process)."
