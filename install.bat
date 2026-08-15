@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
echo ============================================
echo   PRTS installer (Windows)
echo ============================================
echo.

REM ---------- 1. Node.js + npm ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org and re-run.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found.
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 ( call npm i -g pnpm >nul 2>nul )

REM ---------- 2. dsh harness ----------
where dsh >nul 2>nul
if errorlevel 1 (
  echo Installing the dsh harness (^@deepseek-ai/dsh^)...
  call npm i -g @deepseek-ai/dsh
  if errorlevel 1 (
    echo [ERROR] dsh install failed.
    exit /b 1
  )
)

REM ---------- 3. Build the plugin tarball ----------
set "SRC=%~dp0"
pushd "%SRC%"
if not exist "dsh-prts-ui-*.tgz" (
  echo Building the dsh-prts-ui tarball...
  call npm pack --silent
  if errorlevel 1 ( call pnpm pack --silent )
)
set "TGZ="
for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
popd
if "%TGZ%"=="" (
  echo [ERROR] plugin tarball not found.
  exit /b 1
)

REM ---------- 4. Install into the prts profile ----------
set "PROFILE_DIR=%USERPROFILE%\.dsh\profiles\prts"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"
echo Installing plugin into profile 'prts'...
dsh plugin --profile prts install "%SRC%%TGZ%"
if errorlevel 1 (
  echo [ERROR] plugin install failed.
  exit /b 1
)

REM ---------- 5. Pin the minimal bundle ----------
echo Pinning the minimal bundle (dsh-prts-ui)...
node -e "var fs=require('fs'),p=process.argv[1],m=JSON.parse(fs.readFileSync(p,'utf8'));m.dsh=m.dsh||{};m.dsh.profile={bundles:['dsh-prts-ui']};fs.writeFileSync(p,JSON.stringify(m,null,2));" "%PROFILE_DIR%\package.json"

REM ---------- 6. Shortcut ----------
echo Creating the desktop shortcut...
del "%APPDATA%\prts\.shortcut-done" >nul 2>nul
dsh --profile prts --shortcut

REM ---------- 7. prts command on PATH ----------
echo Installing the 'prts' command...
set "BIN=%USERPROFILE%\.local\bin"
if not exist "%BIN%" mkdir "%BIN%"
> "%BIN%\prts.cmd" echo @echo off
>>"%BIN%\prts.cmd" echo dsh --profile prts %*
for /f "usebackq tokens=2*" %%a in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "OLDPATH=%%~b"
echo %OLDPATH% | findstr /c:"%BIN%" >nul 2>nul
if errorlevel 1 (
  setx Path "%OLDPATH%;%BIN%" >nul
  echo NOTE: restarted shells will have 'prts' on PATH.
)

echo.
echo Done!
echo   Terminal client : prts
echo   GUI window      : prts --gui
echo   Remove          : see README "Removing PRTS".
endlocal
