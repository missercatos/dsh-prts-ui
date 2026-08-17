@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
echo ============================================
echo   PRTS installer (Windows)
echo ============================================
echo.

set "PROFILE_DIR=%USERPROFILE%\.dsh\profiles\web"
set "CONFIG_FILE=%PROFILE_DIR%\prts.config.json"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"

REM ---------- 0. Config (prts.config.json from the example) ----------
if not exist "%CONFIG_FILE%" (
  if exist "%~dp0prts.config.example.json" (
    copy /y "%~dp0prts.config.example.json" "%CONFIG_FILE%" >nul
    echo Provisioned %CONFIG_FILE% ^(edit it to change mirrors / plugins / release URL^)
  )
)

REM Read config values via node (single helper).
set "NPM_REG="
set "NPM_REG_FALLBACK=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "DSH_PKG=@deepseek-ai/dsh"
for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.npmRegistry||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do set "NPM_REG=%%v"
for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.npmRegistryFallback||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "NPM_REG_FALLBACK=%%v"
for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.electronMirror||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "ELECTRON_MIRROR=%%v"
for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.dshPackage||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "DSH_PKG=%%v"
set "ELECTRON_MIRROR=%ELECTRON_MIRROR%"

REM ---------- 1. Node.js + npm ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org
  echo         (or https://npmmirror.com/mirrors/node/ in mainland China) and re-run.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found.
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 ( call npm i -g pnpm >nul 2>nul )

REM ---------- 2. dsh harness (npmmirror fallback) ----------
where dsh >nul 2>nul
if errorlevel 1 (
  echo Installing the dsh harness (%DSH_PKG%)...
  call npm i -g "%DSH_PKG%"
  if errorlevel 1 (
    echo [WARN] primary registry failed - retrying with %NPM_REG_FALLBACK%
    call npm i -g "%DSH_PKG%" --registry="%NPM_REG_FALLBACK%"
    if errorlevel 1 (
      echo [ERROR] dsh install failed.
      exit /b 1
    )
  )
)

REM ---------- 3. dsh plugins from prts.config.json ----------
for /f "usebackq delims=" %%p in (`node -e "try{var c=require(process.argv[1]);(c.plugins||[]).forEach(function(p){console.log(p)})}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do (
  echo Installing plugin %%p...
  dsh plugin --profile web add %%p
  if errorlevel 1 echo [WARN] plugin %%p failed to install ^(may not exist on npm^).
)

REM ---------- 4. Build the plugin tarball ----------
set "SRC=%~dp0"
pushd "%SRC%"
set "TGZ="
for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
if "%TGZ%"=="" (
  echo Building the dsh-prts-ui tarball...
  call npm pack --silent
  if errorlevel 1 ( call pnpm pack --silent )
  for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
)
popd
if "%TGZ%"=="" (
  echo [ERROR] plugin tarball not found.
  exit /b 1
)

REM ---------- 5. Install into the prts profile ----------
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"
echo Installing plugin into profile 'prts'...
if exist "%PROFILE_DIR%\node_modules\dsh-prts-ui\package.json" (
  echo PRTS is already installed - skipping re-install. Use update.bat to upgrade.
) else (
  dsh plugin --profile web add "%SRC%%TGZ%"
  if errorlevel 1 (
    echo [ERROR] plugin install failed.
    exit /b 1
  )
)

REM ---------- 6. Pin the bundle (dsh-prts-ui first, other plugins preserved) ----------
echo Pinning the bundle (dsh-prts-ui first, other plugins preserved)...
node -e "var fs=require('fs'),p=process.argv[1],m=JSON.parse(fs.readFileSync(p,'utf8'));m.dsh=m.dsh||{};var ex=(m.dsh.profile&&m.dsh.profile.bundles)||[];m.dsh.profile={bundles:Array.from(new Set(['dsh-prts-ui'].concat(ex)))};fs.writeFileSync(p,JSON.stringify(m,null,2));" "%PROFILE_DIR%\package.json"

REM ---------- 7. Shortcut ----------
echo Creating the desktop shortcut...
del "%APPDATA%\prts\.shortcut-done" >nul 2>nul
dsh --profile web --shortcut

REM ---------- 8. prts command on PATH ----------
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
echo   GUI window      : prts
echo   Update          : Settings menu - Update, or re-run update.bat
echo   Config          : %CONFIG_FILE% (mirrors, plugins, release URL)
echo   Remove          : see README "Removing PRTS".
endlocal
