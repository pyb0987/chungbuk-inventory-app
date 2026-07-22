@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-launcher.ps1"
if errorlevel 1 (
  echo.
  echo ChungbukInventory.exe를 만들지 못했습니다.
  pause
  exit /b 1
)

echo.
echo ChungbukInventory.exe 만들기가 완료되었습니다.
pause
