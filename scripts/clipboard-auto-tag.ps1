param(
  [string]$OutDir = "tmp/clipboard",
  [string]$Prefix = "screenshot",
  [int]$PollMs = 150,
  [int]$MaxAgeDays = 7,
  [int]$MaxFiles = 10,
  [bool]$UseRelativeTagPath = $true,
  [bool]$OnlyWhenVsCodeFocused = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Threading.Thread]::CurrentThread.ApartmentState -ne "STA") {
  $argList = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    $PSCommandPath,
    "-OutDir",
    $OutDir,
    "-Prefix",
    $Prefix,
    "-PollMs",
    "$PollMs",
    "-MaxAgeDays",
    "$MaxAgeDays",
    "-MaxFiles",
    "$MaxFiles"
  )
  $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Wait -PassThru -NoNewWindow
  exit $p.ExitCode
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

function Get-ImageHash([Drawing.Image]$Image) {
  $ms = New-Object IO.MemoryStream
  try {
    $Image.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $hash = $sha.ComputeHash($bytes)
      return ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $ms.Dispose()
  }
}

function Invoke-AutoCleanup {
  param(
    [string]$Dir,
    [string]$NamePrefix,
    [int]$KeepMaxAgeDays,
    [int]$KeepMaxFiles
  )

  if (-not (Test-Path $Dir)) {
    return
  }

  $pattern = "{0}-*.png" -f $NamePrefix
  $files = Get-ChildItem -Path $Dir -Filter $pattern -File -ErrorAction SilentlyContinue
  if (-not $files) {
    return
  }

  if ($KeepMaxAgeDays -gt 0) {
    $cutoff = (Get-Date).AddDays(-$KeepMaxAgeDays)
    $oldFiles = $files | Where-Object { $_.LastWriteTime -lt $cutoff }
    foreach ($file in $oldFiles) {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
    $files = Get-ChildItem -Path $Dir -Filter $pattern -File -ErrorAction SilentlyContinue
  }

  if ($KeepMaxFiles -gt 0 -and $files.Count -gt $KeepMaxFiles) {
    $toDelete = $files |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip $KeepMaxFiles
    foreach ($file in $toDelete) {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-TagPath {
  param(
    [string]$AbsolutePath,
    [string]$OutDirPath,
    [string]$FileName,
    [bool]$UseRelative
  )

  if (-not $UseRelative) {
    return $AbsolutePath
  }

  if ([IO.Path]::IsPathRooted($OutDirPath)) {
    return $AbsolutePath
  }

  return (Join-Path $OutDirPath $FileName)
}

function Get-ForegroundProcessName {
  try {
    $handle = [Win32ForegroundWindow]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) {
      return ""
    }
    $procId = [uint32]0
    [Win32ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$procId) | Out-Null
    if ($procId -eq 0) {
      return ""
    }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) {
      return ""
    }
    return $proc.ProcessName
  } catch {
    return ""
  }
}

function Is-CodexContextFocused {
  if (-not $OnlyWhenVsCodeFocused) {
    return $true
  }
  $name = Get-ForegroundProcessName
  return $name -ieq "Code"
}

function Is-CodexTagText([string]$Text) {
  return $Text -match '^<image path=".+">$'
}

$lastHash = ""
$lastTag = ""
Write-Output "Clipboard auto-tag agent running. Poll: ${PollMs}ms, maxAgeDays: $MaxAgeDays, maxFiles: $MaxFiles"

while ($true) {
  try {
    $img = [Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $img) {
      Start-Sleep -Milliseconds $PollMs
      continue
    }

    $hash = Get-ImageHash -Image $img
    $currentText = ""
    try {
      $currentText = [Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::UnicodeText)
    } catch {
      $currentText = ""
    }

    $isCodeFocused = Is-CodexContextFocused
    $tag = $lastTag
    if ($hash -ne $lastHash -or [string]::IsNullOrWhiteSpace($tag)) {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $fileName = "{0}-{1}.png" -f $Prefix, $timestamp
      $targetPath = Join-Path $OutDir $fileName
      $fullPath = [IO.Path]::GetFullPath($targetPath)
      $img.Save($fullPath, [Drawing.Imaging.ImageFormat]::Png)
      $tagPath = Get-TagPath -AbsolutePath $fullPath -OutDirPath $OutDir -FileName $fileName -UseRelative $UseRelativeTagPath
      $tag = "<image path=""$tagPath"">"
      Write-Output "Saved and tagged: $fullPath"
      Invoke-AutoCleanup -Dir $OutDir -NamePrefix $Prefix -KeepMaxAgeDays $MaxAgeDays -KeepMaxFiles $MaxFiles
    }

    if (-not $isCodeFocused) {
      if (Is-CodexTagText $currentText) {
        [Windows.Forms.Clipboard]::SetImage([Drawing.Image]$img)
      }
      $img.Dispose()
      Start-Sleep -Milliseconds $PollMs
      continue
    }

    if ($hash -eq $lastHash -and $currentText -eq $tag) {
      $img.Dispose()
      Start-Sleep -Milliseconds $PollMs
      continue
    }

    $dataObj = New-Object Windows.Forms.DataObject
    $dataObj.SetImage([Drawing.Image]$img)
    $dataObj.SetText($tag, [Windows.Forms.TextDataFormat]::UnicodeText)
    [Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)

    $lastHash = $hash
    $lastTag = $tag
    $img.Dispose()
  } catch {
    Start-Sleep -Milliseconds $PollMs
  }

  Start-Sleep -Milliseconds $PollMs
}
