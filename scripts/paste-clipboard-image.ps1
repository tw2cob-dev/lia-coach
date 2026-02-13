param(
  [string]$OutDir = "tmp/clipboard",
  [string]$Prefix = "screenshot",
  [switch]$CopyTag,
  [bool]$UseRelativeTagPath = $true
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
    $Prefix
  )
  if ($CopyTag) {
    $argList += "-CopyTag"
  }

  $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Wait -PassThru -NoNewWindow
  exit $p.ExitCode
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$image = [Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
  Write-Error "No hay imagen en el portapapeles. Haz una captura y vuelve a ejecutar: npm run clip"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "{0}-{1}.png" -f $Prefix, $timestamp
$targetPath = Join-Path $OutDir $fileName
$fullPath = [IO.Path]::GetFullPath($targetPath)

$image.Save($fullPath, [Drawing.Imaging.ImageFormat]::Png)
$image.Dispose()

$tagPath = if ($UseRelativeTagPath -and -not [IO.Path]::IsPathRooted($OutDir)) {
  Join-Path $OutDir $fileName
} else {
  $fullPath
}

$codexTag = "<image path=""$tagPath"">"

Write-Output "Saved: $fullPath"
Write-Output "Codex: $codexTag"

if ($CopyTag) {
  Set-Clipboard -Value $codexTag
  Write-Output "Copied tag to clipboard."
}
