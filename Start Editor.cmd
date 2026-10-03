@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or later from https://nodejs.org/, then try again.
  pause
  exit /b 1
)
echo Keep this window open while using the editor.
node serve.js --open
pause
