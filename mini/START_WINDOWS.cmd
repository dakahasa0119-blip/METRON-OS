@echo off
setlocal
cd /d "%~dp0.."
where node.exe >nul 2>nul
if errorlevel 1 (
  echo METRON Mini OS requires Node.js 20 or later.
  echo Install Node.js from the official website, then run this launcher again.
  pause
  exit /b 1
)
echo Opening local METRON Mini OS on port 8766...
start "METRON Mini OS" cmd /k "node mini\start.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/"
exit /b 0
