@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
echo ============================================
echo   PRTS updater (Windows)
echo ============================================
echo.

set "PROFILE_DIR=%USERPROFILE%\.dsh\profiles\prts"
set "CONFIG_FILE=%PROFILE_DIR%\prts.config.json"
set "SRC=%~dp0"

set "NPM_REG_FALLBACK=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "DSH_PKG=@deepseek-ai/dsh"
set "RELEASE_BASE="
if exist "%CONFIG_FILE%" (
  for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.npmRegistryFallback||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "NPM_REG_FALLBACK=%%v"
  for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.electronMirror||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "ELECTRON_MIRROR=%%v"
  for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.dshPackage||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do if not "%%v"=="" set "DSH_PKG=%%v"
  for /f "usebackq delims=" %%v in (`node -e "try{var c=require(process.argv[1]);process.stdout.write(c.releaseBase||'')}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do set "RELEASE_BASE=%%v"
)
set "ELECTRON_MIRROR=%ELECTRON_MIRROR%"

where dsh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] dsh is not installed. Run install.bat first.
  exit /b 1
)

REM ---------- 1. dsh harness ----------
echo Updating the dsh harness (%DSH_PKG%)...
call npm i -g "%DSH_PKG%"
if errorlevel 1 (
  echo [WARN] primary registry failed - retrying with %NPM_REG_FALLBACK%
  call npm i -g "%DSH_PKG%" --registry="%NPM_REG_FALLBACK%"
)

REM ---------- 2. dsh plugins from prts.config.json ----------
for /f "usebackq delims=" %%p in (`node -e "try{var c=require(process.argv[1]);(c.plugins||[]).forEach(function(p){console.log(p)})}catch(e){}" "%CONFIG_FILE%" 2^>nul`) do (
  echo Updating plugin %%p...
  dsh plugin --profile prts add %%p
  if errorlevel 1 echo [WARN] plugin %%p failed to update.
)

REM ---------- 3. PRTS itself: remote release - local rebuild ----------
set "TGZ=%1"
if "%TGZ%"=="" if not "%RELEASE_BASE%"=="" (
  echo Downloading the latest PRTS release from %RELEASE_BASE% ...
  for /f "usebackq delims=" %%u in (`node -e "try{var https=require('https'),http=require('http');var base=process.argv[1].replace(/\/+$/,'');var get=function(url,cb){var mod=url.indexOf('https:')===0?https:http;var req=mod.get(url,function(res){if(res.statusCode!==200){res.resume();cb(null);return;}var b='';res.on('data',function(d){b+=d});res.on('end',function(){cb(b)})});req.on('error',function(){cb(null)});req.setTimeout(20000,function(){req.destroy();cb(null)});};get(base+'/releases.json',function(body){if(!body){process.stdout.write('');return;}try{var m=JSON.parse(body);var l=(m.versions&&m.versions[0])||m.latest||{};process.stdout.write(l.url||l.tgz||'');}catch(e){process.stdout.write('');}});}catch(e){process.stdout.write('');}" "%RELEASE_BASE%" 2^>nul`) do set "DL_URL=%%u"
  if not "!DL_URL!"=="" (
    set "TMP_TGZ=%TEMP%\dsh-prts-ui-remote.tgz"
    curl -fsSL --connect-timeout 15 -o "!TMP_TGZ!" "!DL_URL!"
    if !errorlevel!==0 (
      set "TGZ=!TMP_TGZ!"
      echo downloaded !DL_URL!
    ) else (
      echo [WARN] release download failed - falling back to a local rebuild.
      set "TGZ="
    )
  )
)
if "%TGZ%"=="" (
  pushd "%SRC%"
  echo Rebuilding the dsh-prts-ui tarball...
  call npm pack --silent
  if errorlevel 1 ( call pnpm pack --silent )
  for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
  popd
  set "TGZ=%SRC%!TGZ!"
)
if "%TGZ%"=="" (
  echo [ERROR] tarball not found.
  exit /b 1
)

REM ---------- 4. Install the tarball into the profile ----------
echo Updating the plugin in profile 'prts'...
REM Remove the old install first so the same version also overwrites in place.
dsh plugin --profile prts remove dsh-prts-ui >nul 2>nul
dsh plugin --profile prts add "%TGZ%"
if errorlevel 1 (
  echo [ERROR] plugin update failed.
  exit /b 1
)

REM ---------- 5. Shortcut ----------
echo Refreshing the desktop shortcut...
del "%APPDATA%\prts\.shortcut-done" >nul 2>nul
dsh --profile prts --shortcut

echo.
echo Done - PRTS is up to date.
endlocal
