Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$stopScript = Join-Path $PSScriptRoot "stop-clipboard-agent.ps1"
$startScript = Join-Path $PSScriptRoot "start-clipboard-agent.ps1"

& powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
Start-Sleep -Milliseconds 500
& powershell -NoProfile -ExecutionPolicy Bypass -File $startScript
