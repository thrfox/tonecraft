@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=node"
where node.exe >nul 2>nul
if errorlevel 1 (
  set "NODE_EXE=C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if not exist "%NODE_EXE%" (
    echo Node.js not found. Install Node.js 22 or newer, then run this script again.
    pause
    exit /b 1
  )
)

if not exist "node_modules\vite\bin\vite.js" (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo Dependencies are missing. Install Node.js with npm, then run npm install here.
    pause
    exit /b 1
  )
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Tonecraft development server: http://127.0.0.1:5173/
echo Press Ctrl+C to stop.
"%NODE_EXE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --configLoader runner
pause
