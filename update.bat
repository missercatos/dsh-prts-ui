@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
echo ============================================
echo   PRTS one-click updater (Windows)
echo ============================================

where dsh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] dsh is not installed. Run install.bat first.
  exit /b 1
)

REM ---------- dsh plugins (kept updated alongside PRTS) ----------
REM Same list as install.bat — dsh has no marketplace; `dsh plugin add <pkg>`
REM installs any npm package into the profile bundle.
set "PLUGINS="
if not "%PLUGINS%"=="" (
  echo Updating dsh plugins...
  if not exist "%USERPROFILE%\.dsh\profiles\prts" mkdir "%USERPROFILE%\.dsh\profiles\prts"
  for %%p in (%PLUGINS%) do (
    dsh plugin --profile prts add %%p
    if errorlevel 1 echo [WARN] plugin %%p failed to update (may not exist on npm).
  )
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
dsh plugin --profile prts add "%SRC%%TGZ%"
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
