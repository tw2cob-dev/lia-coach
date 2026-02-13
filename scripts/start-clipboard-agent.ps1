Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "clipboard-auto-tag.ps1"
$repoRoot = Split-Path $PSScriptRoot -Parent

function Get-AgentProcesses {
  $pattern = "(?i)-File\s+.*clipboard-auto-tag\.ps1"
  return Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -like "powershell*" -and
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    $_.CommandLine -match $pattern
  }
}

$running = Get-AgentProcesses

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

Start-Sleep -Milliseconds 700
$started = Get-AgentProcesses
if (-not $started) {
  throw "Clipboard agent failed to start."
}

Write-Output "Clipboard agent started."
