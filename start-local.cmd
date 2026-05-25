@echo off
setlocal

cd /d "%~dp0"

where corepack.cmd >nul 2>nul
if errorlevel 1 (
  echo Corepack was not found. Install Node.js 20+ or enable Corepack, then try again.
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies with Corepack pnpm...
  corepack.cmd pnpm install
  if errorlevel 1 exit /b %errorlevel%
)

if /I "%~1"=="--yes" (
  corepack.cmd pnpm start:local:quick
  exit /b %errorlevel%
)

if /I "%~1"=="--no-interactive" (
  corepack.cmd pnpm start:local:quick
  exit /b %errorlevel%
)

corepack.cmd pnpm start:local
exit /b %errorlevel%
