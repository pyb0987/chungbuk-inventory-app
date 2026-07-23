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
$failedRoot = Join-Path $parent ("ChungbukInventory-failed-" + $token)
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
    "scripts\safe-database-copy.mjs",
    "scripts\health-check-portable.mjs"
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

function Move-DirectoryWithRetry([string]$Source, [string]$Destination) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      [IO.Directory]::Move($Source, $Destination)
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (250 * $attempt)
    }
  }
  throw $lastError
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
  Move-DirectoryWithRetry $appRootPath $previousRoot
  try {
    Move-DirectoryWithRetry $stageRoot $appRootPath
    $swapped = $true
  } catch {
    Move-DirectoryWithRetry $previousRoot $appRootPath
    throw
  }

  $health = Start-Process `
    -FilePath (Join-Path $appRootPath "ChungbukInventory.exe") `
    -ArgumentList @("--health-check", $ExpectedVersion) `
    -Wait `
    -PassThru
  if ($health.ExitCode -ne 0) {
    throw "새 버전 상태 확인에 실패했습니다."
  }

  if (-not $NoRestart) {
    Start-Process (Join-Path $appRootPath "ChungbukInventory.exe")
  }
  Remove-Item -LiteralPath $previousRoot -Recurse -Force -ErrorAction SilentlyContinue
  $previousRoot = $null
} catch {
  $failed = $true
  if ($swapped -and $previousRoot -and (Test-Path -LiteralPath $previousRoot)) {
    try {
      if (Test-Path -LiteralPath $appRootPath) {
        Move-DirectoryWithRetry $appRootPath $failedRoot
      }
      Move-DirectoryWithRetry $previousRoot $appRootPath
      $previousRoot = $null
    } catch {
      $recoveryNote = Join-Path $parent "ChungbukInventory-RECOVERY.txt"
      @(
        "자동 복구에 실패했습니다.",
        "정상 이전 버전: $previousRoot",
        "실패한 새 버전: $failedRoot",
        "이전 버전의 ChungbukInventory.exe를 실행해 주세요."
      ) | Set-Content -LiteralPath $recoveryNote -Encoding utf8
    }
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
  if (-not $NoRestart) {
    $recoveryExe = if (Test-Path -LiteralPath (Join-Path $appRootPath "ChungbukInventory.exe")) {
      Join-Path $appRootPath "ChungbukInventory.exe"
    } elseif ($previousRoot -and (Test-Path -LiteralPath (Join-Path $previousRoot "ChungbukInventory.exe"))) {
      Join-Path $previousRoot "ChungbukInventory.exe"
    }
    if ($recoveryExe) {
      Start-Process $recoveryExe
    }
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
