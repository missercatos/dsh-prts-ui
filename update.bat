@echo off
setlocal enabledelocalexpansion
chcp 65001 >nul 2>nul
echo ============================================
echo   PRTS one-click updater (Windows)
echo ============================================

where dsh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] dsh is not installed. Run install.bat first.
  exit /b 1
)

set "SRC=%~dp0"
set "TGZ=%~1"
if "%TGZ%"=="" (
  echo Rebuilding the dsh-prts-ui tarball...
  pushd "%SRC%"
  call npm pack --silent
  if errorlevel 1 ( call pnpm pack --silent )
  for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
  popd
)
if "%TGZ%"=="" (
  echo [ERROR] tarball not found.
  exit /b 1
)

echo Updating the plugin in profile 'prts'...
dsh plugin --profile prts install "%SRC%%TGZ%"
if errorlevel 1 (
  echo [WARN] pnpm reported a warning; continuing.
)
if not exist "%USERPROFILE%\.dsh\profiles\prts\node_modules\dsh-prts-ui\package.json" (
  echo [ERROR] plugin not present after update.
  exit /b 1
)

echo Refreshing the desktop shortcut...
del "%APPDATA%\prts\.shortcut-done" >nul 2>nul
dsh --profile prts --shortcut

echo.
echo Done - PRTS is up to date.
endlocal
