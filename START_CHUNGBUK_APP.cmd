@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5177"
set "LEGACY_DATA_DIR=%~dp0user-data"
set "CHUNGBUK_DATA_DIR=%LOCALAPPDATA%\ChungbukInventory"

if not exist "%CHUNGBUK_DATA_DIR%" mkdir "%CHUNGBUK_DATA_DIR%"
if not exist "%CHUNGBUK_DATA_DIR%\backups" mkdir "%CHUNGBUK_DATA_DIR%\backups"
if not exist "%CHUNGBUK_DATA_DIR%\chungbuk-inventory.sqlite" if exist "%LEGACY_DATA_DIR%\chungbuk-inventory.sqlite" (
  echo 기존 사용자 데이터를 Windows 사용자 데이터 폴더로 복사합니다...
  xcopy "%LEGACY_DATA_DIR%\*" "%CHUNGBUK_DATA_DIR%\" /E /I /Y >nul
)

set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  echo 오류: 내장 Node 실행 파일을 찾을 수 없습니다.
  echo 예상 위치: %NODE_EXE%
  echo.
  echo 전달 전에 Windows용 Node.js 25 이상 런타임을 runtime\node\node.exe 위치에 넣어 주세요.
  echo 개발용으로 실행할 때는 npm start를 사용해 주세요.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" -e "const major=Number(process.versions.node.split('.')[0]); if (major < 25) { console.error('Node.js 25 이상이 필요합니다. 현재 버전: ' + process.version); process.exit(1); } try { require('node:sqlite'); } catch (error) { console.error('현재 Node 런타임에서 node:sqlite를 사용할 수 없습니다.'); process.exit(1); }"
if errorlevel 1 (
  echo.
  echo 오류: 내장 Node 런타임이 이 앱과 호환되지 않습니다.
  echo.
  pause
  exit /b 1
)

echo 충북 재고관리 앱을 시작합니다...
echo URL: http://127.0.0.1:%PORT%/
echo 데이터 폴더: %CHUNGBUK_DATA_DIR%
echo.

"%NODE_EXE%" "%~dp0scripts\start-portable.mjs"

echo.
echo 앱이 종료되었습니다. 이 창을 닫아도 됩니다.
pause
