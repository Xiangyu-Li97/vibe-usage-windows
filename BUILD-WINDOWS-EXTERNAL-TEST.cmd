@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-external-test.ps1"
set "build_exit=%ERRORLEVEL%"

echo.
if "%build_exit%"=="0" (
  echo Build completed. The external-test installer is in this folder.
) else (
  echo Build failed with exit code %build_exit%.
)
pause
exit /b %build_exit%
