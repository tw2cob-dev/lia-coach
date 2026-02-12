param(
  [string]$OutDir = "tmp/clipboard",
  [string]$Prefix = "screenshot",
  [int]$PollMs = 700,
  [int]$MaxAgeDays = 7,
  [int]$MaxFiles = 10
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

$lastHash = ""
Write-Output "Clipboard auto-tag agent running. Poll: ${PollMs}ms, maxAgeDays: $MaxAgeDays, maxFiles: $MaxFiles"

while ($true) {
  try {
    $img = [Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $img) {
      Start-Sleep -Milliseconds $PollMs
      continue
    }

    $hash = Get-ImageHash -Image $img
    if ($hash -eq $lastHash) {
      $img.Dispose()
      Start-Sleep -Milliseconds $PollMs
      continue
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $fileName = "{0}-{1}.png" -f $Prefix, $timestamp
    $targetPath = Join-Path $OutDir $fileName
    $fullPath = [IO.Path]::GetFullPath($targetPath)

    $img.Save($fullPath, [Drawing.Imaging.ImageFormat]::Png)

    $tag = "<image path=""$fullPath"">"
    $dataObj = New-Object Windows.Forms.DataObject
    $dataObj.SetImage([Drawing.Image]$img)
    $dataObj.SetText($tag, [Windows.Forms.TextDataFormat]::UnicodeText)
    [Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)

    $lastHash = $hash
    Write-Output "Saved and tagged: $fullPath"
    $img.Dispose()
    Invoke-AutoCleanup -Dir $OutDir -NamePrefix $Prefix -KeepMaxAgeDays $MaxAgeDays -KeepMaxFiles $MaxFiles
  } catch {
    Start-Sleep -Milliseconds $PollMs
  }

  Start-Sleep -Milliseconds $PollMs
}
