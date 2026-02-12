Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$startupDir = [Environment]::GetFolderPath("Startup")
$cmdPath = Join-Path $startupDir "lia-codex-clipboard-agent.cmd"

$startScript = Join-Path $repoRoot "scripts\\start-clipboard-agent.ps1"
$content = "@echo off`r`ncd /d ""$repoRoot""`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""$startScript""`r`n"

Set-Content -Path $cmdPath -Value $content -Encoding ASCII

Write-Output "Startup entry installed: $cmdPath"
