param(
  [Parameter(Mandatory = $true)][int]$LauncherPid,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = "Stop"
$extractRoot = Join-Path $env:TEMP ("ChungbukInventory-update-" + [Guid]::NewGuid().ToString("N"))

try {
  Wait-Process -Id $LauncherPid -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $extractRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $extractRoot -Force

  # User data lives under LocalAppData and is never part of this replacement.
  Copy-Item (Join-Path $extractRoot "*") $AppRoot -Recurse -Force
  Start-Process (Join-Path $AppRoot "ChungbukInventory.exe")
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "업데이트를 적용하지 못했습니다.`n`n$($_.Exception.Message)",
    "충북 재고관리",
    "OK",
    "Error"
  ) | Out-Null
} finally {
  Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
}
