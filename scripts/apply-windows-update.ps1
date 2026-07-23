param(
  [Parameter(Mandatory = $true)][int]$LauncherPid,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"
$appRootPath = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
$parent = [IO.Directory]::GetParent($appRootPath).FullName
$token = [Guid]::NewGuid().ToString("N")
$stageRoot = Join-Path $parent ("ChungbukInventory-stage-" + $token)
$previousRoot = Join-Path $parent ("ChungbukInventory-previous-" + $token)
$swapped = $false
$failed = $false

function Assert-Package([string]$Root, [string]$Version) {
  $required = @(
    "ChungbukInventory.exe",
    "APP_VERSION",
    "package.json",
    "runtime\node\node.exe",
    "scripts\start-portable.mjs",
    "scripts\apply-windows-update.ps1",
    "scripts\safe-database-copy.mjs"
  )
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
      throw "업데이트 패키지 필수 파일이 없습니다: $relative"
    }
  }
  $actualVersion = (Get-Content -LiteralPath (Join-Path $Root "APP_VERSION") -Raw).Trim()
  if ($actualVersion -ne $Version) {
    throw "업데이트 버전이 일치하지 않습니다: expected=$Version actual=$actualVersion"
  }
}

try {
  New-Item -ItemType Directory -Force $stageRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $stageRoot -Force
  Assert-Package $stageRoot $ExpectedVersion

  # Prove the parent is writable before touching the current installation.
  $writeProbe = Join-Path $parent ("ChungbukInventory-write-test-" + $token)
  [IO.File]::WriteAllText($writeProbe, "ok")
  Remove-Item -LiteralPath $writeProbe -Force

  Wait-Process -Id $LauncherPid -ErrorAction SilentlyContinue
  [IO.Directory]::Move($appRootPath, $previousRoot)
  try {
    [IO.Directory]::Move($stageRoot, $appRootPath)
    $swapped = $true
  } catch {
    [IO.Directory]::Move($previousRoot, $appRootPath)
    throw
  }

  $health = Start-Process `
    -FilePath (Join-Path $appRootPath "ChungbukInventory.exe") `
    -ArgumentList "--health-check" `
    -Wait `
    -PassThru
  if ($health.ExitCode -ne 0) {
    throw "새 버전 상태 확인에 실패했습니다."
  }

  if (-not $NoRestart) {
    Start-Process (Join-Path $appRootPath "ChungbukInventory.exe")
  }
  Remove-Item -LiteralPath $previousRoot -Recurse -Force
  $previousRoot = $null
} catch {
  $failed = $true
  if ($swapped -and $previousRoot -and (Test-Path -LiteralPath $previousRoot)) {
    Remove-Item -LiteralPath $appRootPath -Recurse -Force -ErrorAction SilentlyContinue
    [IO.Directory]::Move($previousRoot, $appRootPath)
    $previousRoot = $null
  }
  if ($NoRestart) {
    Write-Error "업데이트를 적용하지 못해 이전 버전을 유지했습니다: $($_.Exception.Message)"
  } else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "업데이트를 적용하지 못해 이전 버전을 유지했습니다.`n`n$($_.Exception.Message)",
      "충북 재고관리",
      "OK",
      "Error"
    ) | Out-Null
  }
  if (-not $NoRestart -and (Test-Path -LiteralPath (Join-Path $appRootPath "ChungbukInventory.exe"))) {
    Start-Process (Join-Path $appRootPath "ChungbukInventory.exe")
  }
} finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
}

if ($failed) {
  exit 1
}
