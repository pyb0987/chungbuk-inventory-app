param(
  [int]$LauncherPid,
  [string]$ArchivePath,
  [string]$AppRoot,
  [string]$ExpectedVersion,
  [string]$LogPath,
  [string]$RecoverState,
  [string]$RestartMarker,
  [switch]$Recover,
  [switch]$NoRestart,
  [switch]$NoDialogs,
  [switch]$TestExitAfterPreviousMove
)

if (-not $LauncherPid -and $env:CHUNGBUK_UPDATER_LAUNCHER_PID) {
  $LauncherPid = [int]$env:CHUNGBUK_UPDATER_LAUNCHER_PID
}
if (-not $ArchivePath) {
  $ArchivePath = $env:CHUNGBUK_UPDATER_ARCHIVE_PATH
}
if (-not $AppRoot) {
  $AppRoot = $env:CHUNGBUK_UPDATER_APP_ROOT
}
if (-not $ExpectedVersion) {
  $ExpectedVersion = $env:CHUNGBUK_UPDATER_EXPECTED_VERSION
}
if (-not $LogPath) {
  $LogPath = $env:CHUNGBUK_UPDATER_LOG_PATH
}
if (-not $RestartMarker) {
  $RestartMarker = $env:CHUNGBUK_UPDATER_RESTART_MARKER
}
if ($env:CHUNGBUK_UPDATER_NO_DIALOGS -eq "1") {
  $NoDialogs = $true
}
if ($env:CHUNGBUK_UPDATER_NO_RESTART -eq "1") {
  $NoRestart = $true
}

$ErrorActionPreference = "Stop"
$startupRunPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startupRunName = "ChungbukInventoryUpdateRecovery"
$lockStream = $null
$commonDocuments = [Environment]::GetFolderPath(
  [Environment+SpecialFolder]::CommonDocuments)
$defaultRecoveryRoot = Join-Path $commonDocuments "ChungbukInventory\updater-recovery"
$defaultRecoveryState = Join-Path $defaultRecoveryRoot "state.json"
$defaultRecoveryScript = Join-Path $defaultRecoveryRoot "recover.ps1"

function Write-SafeLog([string]$Path, [string]$Token, [string]$Message) {
  try {
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    New-Item -ItemType Directory -Force $directory | Out-Null
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"), $Token, $Message
    Add-Content -LiteralPath $Path -Value $line -Encoding utf8
  } catch {
    # Diagnostics must never block installation recovery.
  }
}

function Write-AtomicState([string]$Path, [hashtable]$State) {
  $temporary = $Path + ".tmp-" + [Guid]::NewGuid().ToString("N")
  $backup = $Path + ".bak-" + [Guid]::NewGuid().ToString("N")
  try {
    $State.updatedAt = (Get-Date).ToString("o")
    $State | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
    if (Test-Path -LiteralPath $Path) {
      # .NET Framework's File.Replace rejects a null backup path even though
      # newer runtimes accept it.
      [IO.File]::Replace($temporary, $Path, $backup)
    } else {
      [IO.File]::Move($temporary, $Path)
    }
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
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

function Quote-NativeArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) {
    return '""'
  }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Assert-RecoveryState($State) {
  $allowedPhases = @(
    "staging",
    "moving-previous",
    "installing-candidate",
    "health-check",
    "rolling-back",
    "candidate-committed"
  )
  if ($State.schema -ne 1) {
    throw "지원하지 않는 복구 상태 형식입니다."
  }
  if ($State.token -notmatch "^[a-f0-9]{32}$") {
    throw "복구 상태 토큰이 올바르지 않습니다."
  }
  if ($allowedPhases -notcontains $State.phase) {
    throw "복구 상태 단계가 올바르지 않습니다."
  }

  $appRoot = [IO.Path]::GetFullPath([string]$State.appRoot).TrimEnd('\')
  $parent = [IO.Directory]::GetParent($appRoot).FullName
  $expectedPaths = @{
    stageRoot = Join-Path $parent ("ChungbukInventory-stage-" + $State.token)
    previousRoot = Join-Path $parent ("ChungbukInventory-previous-" + $State.token)
    failedRoot = Join-Path $parent ("ChungbukInventory-failed-" + $State.token)
    retiredRoot = Join-Path $parent ("ChungbukInventory-retired-" + $State.token)
  }
  foreach ($name in $expectedPaths.Keys) {
    $actual = [IO.Path]::GetFullPath([string]$State.$name).TrimEnd('\')
    if (-not [String]::Equals(
      $actual,
      $expectedPaths[$name],
      [StringComparison]::OrdinalIgnoreCase)) {
      throw "복구 상태 경로가 설치 폴더와 일치하지 않습니다: $name"
    }
  }
  $allPaths = @(
    $appRoot,
    $expectedPaths.stageRoot,
    $expectedPaths.previousRoot,
    $expectedPaths.failedRoot,
    $expectedPaths.retiredRoot
  )
  $distinctPaths = $allPaths |
    ForEach-Object { $_.ToLowerInvariant() } |
    Select-Object -Unique
  if ($distinctPaths.Count -ne $allPaths.Count) {
    throw "복구 상태 경로가 서로 겹칩니다."
  }
  if ([String]::IsNullOrWhiteSpace([string]$State.expectedVersion)) {
    throw "복구 대상 버전이 없습니다."
  }
  if (-not [String]::Equals(
    [IO.Path]::GetFullPath([string]$State.recoveryScript),
    [IO.Path]::GetFullPath($defaultRecoveryScript),
    [StringComparison]::OrdinalIgnoreCase)) {
    throw "복구 스크립트 경로가 올바르지 않습니다."
  }
}

function Acquire-UpdateLock([string]$Parent) {
  New-Item -ItemType Directory -Force $Parent | Out-Null
  $lockPath = Join-Path $Parent "update.lock"
  try {
    return [IO.File]::Open(
      $lockPath,
      [IO.FileMode]::OpenOrCreate,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None)
  } catch {
    throw "다른 업데이트 또는 복구 작업이 이미 실행 중입니다."
  }
}

function Clear-RecoveryRegistration {
  Remove-ItemProperty `
    -Path $startupRunPath `
    -Name $startupRunName `
    -Force `
    -ErrorAction SilentlyContinue
}

function Register-Recovery {
  New-Item -ItemType Directory -Force $defaultRecoveryRoot | Out-Null
  $recoveryCommand =
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' +
    '"' + $defaultRecoveryScript + '" -Recover'
  New-Item -Path $startupRunPath -Force | Out-Null
  New-ItemProperty `
    -Path $startupRunPath `
    -Name $startupRunName `
    -Value $recoveryCommand `
    -PropertyType String `
    -Force | Out-Null
}

function Remove-RecoveryArtifacts([string]$StatePath, [string]$RecoveryScriptPath) {
  Clear-RecoveryRegistration
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  if ($RecoveryScriptPath) {
    Remove-Item -LiteralPath $RecoveryScriptPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-InterruptedUpdateRecovery([string]$StatePath) {
  $state = $null
  $parent = $defaultRecoveryRoot
  try {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
      Clear-RecoveryRegistration
      return
    }

    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    Assert-RecoveryState $state
    $parent = [IO.Directory]::GetParent([IO.Path]::GetFullPath($state.appRoot)).FullName
    Set-Location -LiteralPath $parent
    $script:lockStream = Acquire-UpdateLock $defaultRecoveryRoot
    Write-SafeLog $state.logPath $state.token "recovery-start phase=$($state.phase)"

    $appExists = Test-Path -LiteralPath $state.appRoot -PathType Container
    $previousExists = Test-Path -LiteralPath $state.previousRoot -PathType Container
    $candidateCommitted = $state.phase -eq "committing" -or $state.phase -eq "candidate-committed"

    if ($candidateCommitted) {
      if (-not $appExists -or
        -not (Test-Path -LiteralPath (Join-Path $state.appRoot "ChungbukInventory.exe") -PathType Leaf) -or
        ((Get-Content -LiteralPath (Join-Path $state.appRoot "APP_VERSION") -Raw).Trim() -ne $state.expectedVersion)) {
        throw "커밋된 새 앱 폴더를 확인할 수 없습니다."
      }
      Write-SafeLog $state.logPath $state.token "recovery=committed-candidate-retained"
    } elseif ($previousExists) {
      if ($appExists) {
        $recoveryFailedRoot = $state.failedRoot + "-recovery"
        Move-DirectoryWithRetry $state.appRoot $recoveryFailedRoot
      }
      Move-DirectoryWithRetry $state.previousRoot $state.appRoot
      Write-SafeLog $state.logPath $state.token "recovery=restored-previous"
    } elseif (-not $appExists) {
      throw "복구할 이전 앱 폴더와 현재 앱 폴더가 모두 없습니다."
    } else {
      Write-SafeLog $state.logPath $state.token "recovery=current-root-retained"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $state.appRoot "ChungbukInventory.exe") -PathType Leaf)) {
      throw "복구된 앱 폴더에 ChungbukInventory.exe가 없습니다."
    }

    Remove-Item -LiteralPath $state.stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($state.retiredRoot) {
      Remove-Item -LiteralPath $state.retiredRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-RecoveryArtifacts $StatePath $state.recoveryScript
    Write-SafeLog $state.logPath $state.token "recovery=success"
    if (-not $NoRestart) {
      Start-Process (Join-Path $state.appRoot "ChungbukInventory.exe")
    }
  } catch {
    $fallbackLog = Join-Path $defaultRecoveryRoot "recovery.log"
    $recoveryLog = if ($state -and $state.logPath) { $state.logPath } else { $fallbackLog }
    $recoveryToken = if ($state -and $state.token) { $state.token } else { "bootstrap" }
    Write-SafeLog $recoveryLog $recoveryToken "recovery-error=$($_ | Out-String)"
    try {
      Register-Recovery
    } catch {
      Write-SafeLog $recoveryLog $recoveryToken "recovery-reregistration-error=$($_ | Out-String)"
    }
    $recoveryNote = Join-Path $parent "ChungbukInventory-RECOVERY.txt"
    @(
      "중단된 업데이트의 자동 복구에 실패했습니다.",
      "현재 앱: $(if ($state) { $state.appRoot } else { '상태 파일을 읽지 못했습니다.' })",
      "정상 이전 버전 후보: $(if ($state) { $state.previousRoot } else { '상태 파일을 확인해 주세요.' })",
      "실패한 새 버전 후보: $(if ($state) { $state.failedRoot } else { '상태 파일을 확인해 주세요.' })",
      "복구 오류: $($_.Exception.Message)",
      "자세한 로그: $recoveryLog",
      "복구가 성공할 때까지 다음 로그인마다 다시 시도합니다."
    ) | Set-Content -LiteralPath $recoveryNote -Encoding utf8
    throw
  } finally {
    if ($script:lockStream) {
      $script:lockStream.Dispose()
      $script:lockStream = $null
    }
  }
}

if ($Recover -or $RecoverState) {
  $stateToRecover = if ($RecoverState) {
    [IO.Path]::GetFullPath($RecoverState)
  } else {
    $defaultRecoveryState
  }
  Invoke-InterruptedUpdateRecovery $stateToRecover
  exit 0
}

if (-not $LauncherPid -or -not $ArchivePath -or -not $AppRoot -or -not $ExpectedVersion) {
  throw "업데이트 실행 인수가 부족합니다."
}

$appRootPath = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
$parent = [IO.Directory]::GetParent($appRootPath).FullName
$updaterScriptPath = $MyInvocation.MyCommand.Path
$token = [Guid]::NewGuid().ToString("N")
$stageRoot = Join-Path $parent ("ChungbukInventory-stage-" + $token)
$previousRoot = Join-Path $parent ("ChungbukInventory-previous-" + $token)
$failedRoot = Join-Path $parent ("ChungbukInventory-failed-" + $token)
$statePath = $defaultRecoveryState
$recoveryScript = $defaultRecoveryScript
$retiredRoot = Join-Path $parent ("ChungbukInventory-retired-" + $token)
$previousMoved = $false
$candidateInstalled = $false
$rollbackSucceeded = $false
$failed = $false
$updateError = $null
$rollbackError = $null
$ownsRecoveryState = $false
$registeredRecovery = $false

if (-not $LogPath) {
  $LogPath = Join-Path $parent ("ChungbukInventory-update-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
}
$LogPath = [IO.Path]::GetFullPath($LogPath)

$state = @{
  schema = 1
  token = $token
  phase = "initializing"
  appRoot = $appRootPath
  stageRoot = $stageRoot
  previousRoot = $previousRoot
  failedRoot = $failedRoot
  expectedVersion = $ExpectedVersion
  logPath = $LogPath
  recoveryScript = $recoveryScript
  retiredRoot = $retiredRoot
}

function Set-UpdatePhase([string]$Phase) {
  $state.phase = $Phase
  Write-AtomicState $statePath $state
  Write-SafeLog $LogPath $token "phase=$Phase"
}

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

try {
  Set-Location -LiteralPath $parent
  $lockStream = Acquire-UpdateLock $defaultRecoveryRoot
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    throw "완료되지 않은 이전 업데이트의 복구가 필요합니다. Windows에 다시 로그인해 주세요."
  }
  New-Item -ItemType Directory -Force $defaultRecoveryRoot | Out-Null
  Copy-Item -LiteralPath $updaterScriptPath -Destination $recoveryScript -Force
  Register-Recovery
  $registeredRecovery = $true
  Write-SafeLog $LogPath $token "start appRoot=$appRootPath expectedVersion=$ExpectedVersion archive=$ArchivePath cwd=$((Get-Location).Path)"
  Set-UpdatePhase "staging"
  $ownsRecoveryState = $true

  New-Item -ItemType Directory -Force $stageRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $stageRoot -Force
  Assert-Package $stageRoot $ExpectedVersion

  $writeProbe = Join-Path $parent ("ChungbukInventory-write-test-" + $token)
  [IO.File]::WriteAllText($writeProbe, "ok")
  Remove-Item -LiteralPath $writeProbe -Force

  Wait-Process -Id $LauncherPid -ErrorAction SilentlyContinue
  Set-UpdatePhase "moving-previous"
  Move-DirectoryWithRetry $appRootPath $previousRoot
  $previousMoved = $true
  if ($TestExitAfterPreviousMove) {
    Write-SafeLog $LogPath $token "test-interruption=after-previous-move"
    exit 86
  }

  Set-UpdatePhase "installing-candidate"
  Move-DirectoryWithRetry $stageRoot $appRootPath
  $candidateInstalled = $true

  Set-UpdatePhase "health-check"
  $health = Start-Process `
    -FilePath (Join-Path $appRootPath "ChungbukInventory.exe") `
    -ArgumentList @("--health-check", $ExpectedVersion) `
    -Wait `
    -PassThru
  if ($health.ExitCode -ne 0) {
    throw "새 버전 상태 확인에 실패했습니다."
  }

  Move-DirectoryWithRetry $previousRoot $retiredRoot
  $previousMoved = $false
  Set-UpdatePhase "candidate-committed"
  Remove-Item -LiteralPath $retiredRoot -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $retiredRoot) {
    Write-SafeLog $LogPath $token "cleanup-warning couldNotDeleteRetired=$retiredRoot"
  }
  Remove-RecoveryArtifacts $statePath $recoveryScript
  Write-SafeLog $LogPath $token "success version=$ExpectedVersion"
} catch {
  $failed = $true
  $updateError = $_
  Write-SafeLog $LogPath $token "update-error=$($updateError | Out-String)"

  if ($previousMoved -and (Test-Path -LiteralPath $previousRoot -PathType Container)) {
    try {
      $state.phase = "rolling-back"
      try {
        Write-AtomicState $statePath $state
      } catch {
        Write-SafeLog $LogPath $token "state-warning=$($_ | Out-String)"
      }
      Write-SafeLog $LogPath $token "phase=rolling-back"

      if ($candidateInstalled -and (Test-Path -LiteralPath $appRootPath -PathType Container)) {
        Move-DirectoryWithRetry $appRootPath $failedRoot
      }
      Move-DirectoryWithRetry $previousRoot $appRootPath
      $previousMoved = $false
      $rollbackSucceeded = $true
      Write-SafeLog $LogPath $token "rollback=success failedCandidate=$failedRoot"
      Remove-Item -LiteralPath $failedRoot -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
      $rollbackError = $_
      Write-SafeLog $LogPath $token "rollback-error=$($rollbackError | Out-String)"
    }
  }

  if ($ownsRecoveryState -and ($rollbackSucceeded -or -not $previousMoved)) {
    Remove-RecoveryArtifacts $statePath $recoveryScript
  } elseif ($registeredRecovery -and -not $ownsRecoveryState) {
    Remove-RecoveryArtifacts $statePath $recoveryScript
  }

  if ($rollbackError -or ($previousMoved -and -not $rollbackSucceeded)) {
    $recoveryNote = Join-Path $parent "ChungbukInventory-RECOVERY.txt"
    @(
      "자동 복구에 실패했습니다.",
      "정상 이전 버전: $previousRoot",
      "실패한 새 버전: $failedRoot",
      "업데이트 오류: $($updateError.Exception.Message)",
      "복구 오류: $(if ($rollbackError) { $rollbackError.Exception.Message } else { '이전 앱 폴더를 복구하지 못했습니다.' })",
      "자세한 로그: $LogPath",
      "Windows에 다시 로그인하면 자동 복구를 다시 시도합니다."
    ) | Set-Content -LiteralPath $recoveryNote -Encoding utf8
  }

  $errorMessage = $updateError.Exception.Message
  if ($rollbackError) {
    $errorMessage += "`n복구 오류: " + $rollbackError.Exception.Message
  }
  if ($NoRestart) {
    Write-Error "업데이트를 적용하지 못해 이전 버전을 유지했습니다: $errorMessage"
  } elseif (-not $NoDialogs) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "업데이트를 적용하지 못했습니다.`n`n$errorMessage`n`n로그: $LogPath",
      "충북 재고관리",
      "OK",
      "Error"
    ) | Out-Null
  }
} finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
  if ($lockStream) {
    $lockStream.Dispose()
    $lockStream = $null
  }
  if ($updaterScriptPath -and
    -not $updaterScriptPath.StartsWith($appRootPath, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $updaterScriptPath -Force -ErrorAction SilentlyContinue
  }
}

if ($failed) {
  if (-not $NoRestart -and $rollbackSucceeded) {
    if ($RestartMarker) {
      Start-Process `
        -FilePath (Join-Path $appRootPath "ChungbukInventory.exe") `
        -ArgumentList (
          "--restart-readiness-test " +
          (Quote-NativeArgument $RestartMarker) +
          " rollback") `
        -Wait
    } else {
      Start-Process (Join-Path $appRootPath "ChungbukInventory.exe")
    }
  }
  exit 1
}

if (-not $NoRestart) {
  if ($RestartMarker) {
    Start-Process `
      -FilePath (Join-Path $appRootPath "ChungbukInventory.exe") `
      -ArgumentList (
        "--restart-readiness-test " +
        (Quote-NativeArgument $RestartMarker) +
        " success") `
      -Wait
  } else {
    Start-Process (Join-Path $appRootPath "ChungbukInventory.exe")
  }
}
