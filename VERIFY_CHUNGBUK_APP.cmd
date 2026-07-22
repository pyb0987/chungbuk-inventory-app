@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  echo 오류: 내장 Node 실행 파일을 찾을 수 없습니다.
  echo 예상 위치: %NODE_EXE%
  echo.
  pause
  exit /b 1
)

echo 충북 재고관리 앱 폴더를 확인하는 중입니다...
echo.

"%NODE_EXE%" "%~dp0scripts\verify-portable-runtime.mjs" --require-launcher-exe
if errorlevel 1 (
  echo.
  echo 확인에 실패했습니다. 이 창의 내용을 개발자에게 전달해 주세요.
  echo.
  pause
  exit /b 1
)

echo.
echo 확인이 완료되었습니다.
echo 다음 단계: ChungbukInventory.exe를 실행한 뒤 현재 재고 엑셀 파일을 가져오세요.
echo.
pause
