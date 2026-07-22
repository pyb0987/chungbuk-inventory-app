$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourcePath = Join-Path $projectRoot "launcher\ChungbukInventoryLauncher.cs"
$outputPath = Join-Path $projectRoot "ChungbukInventory.exe"

if (-not (Test-Path $sourcePath)) {
  throw "실행 파일 원본을 찾을 수 없습니다: $sourcePath"
}

$candidateCompilers = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
) | Where-Object { Test-Path $_ }

if ($candidateCompilers.Count -eq 0) {
  $whereResult = & where.exe csc 2>$null
  if ($LASTEXITCODE -eq 0 -and $whereResult) {
    $candidateCompilers = @($whereResult[0])
  }
}

if ($candidateCompilers.Count -eq 0) {
  throw "csc.exe를 찾을 수 없습니다. .NET Framework Developer Pack을 설치하거나 C# 컴파일러가 있는 Windows 컴퓨터에서 만들어 주세요."
}

$compiler = $candidateCompilers[0]
Write-Host "사용할 C# 컴파일러: $compiler"

& $compiler `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /out:$outputPath `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  $sourcePath

if ($LASTEXITCODE -ne 0) {
  throw "실행 파일 만들기에 실패했습니다."
}

Write-Host "Windows 실행 파일 생성 완료: $outputPath"
