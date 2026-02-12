Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "clipboard-auto-tag.ps1"
$repoRoot = Split-Path $PSScriptRoot -Parent

$pattern = "(?i)-File\s+.*clipboard-auto-tag\.ps1"
$running = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -like "powershell*" -and
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    $_.CommandLine -match $pattern
  }

if ($running) {
  Write-Output "Clipboard agent already running."
  exit 0
}

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-STA",
  "-File",
  $scriptPath
) -WorkingDirectory $repoRoot | Out-Null

Write-Output "Clipboard agent started."
