@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Build a Windows .exe installer (PRTS-Setup.exe) using
REM  IExpress, which ships with Windows (no extra tools needed).
REM  Run this on a Windows machine inside the repo checkout.
REM  The exe self-extracts the full source tree and runs
REM  install.bat (the PRTS wizard: dsh + plugins + GUI + theme).
REM ============================================================
set "SRC=%~dp0"
set "STAGE=%TEMP%\prts-setup-build"
if exist "%STAGE%" rmdir /s /q "%STAGE%" >nul 2>nul
mkdir "%STAGE%"

REM find the tarball (build it if missing)
set "TGZ="
for /f "delims=" %%i in ('dir /b "%SRC%dsh-prts-ui-*.tgz" 2^>nul') do set "TGZ=%%i"
if "%TGZ%"=="" (
  echo Building tarball first...
  pushd "%SRC%"
  call npm pack --silent
  for /f "delims=" %%i in ('dir /b dsh-prts-ui-*.tgz 2^>nul') do set "TGZ=%%i"
  popd
)
if "%TGZ%"=="" (
  echo [ERROR] no dsh-prts-ui tarball found.
  exit /b 1
)

REM stage the full payload (same set make-dist.sh ships)
for %%d in (bin src web electron assets scripts wizard vendor) do (
  xcopy /e /i /q /y "%SRC%%%d" "%STAGE%\%%d" >nul
)
for %%f in (cordis.patch.yml package.json LICENSE README.md README.zh.md install.sh install.bat prts.config.example.json) do (
  if exist "%SRC%%%f" copy /y "%SRC%%%f" "%STAGE%\%%f" >nul
)
copy /y "%SRC%%TGZ%" "%STAGE%\%TGZ%" >nul
cd /d "%STAGE%"

> prts-setup.sed (
  echo [Version]
  echo Class=IEXPRESS
  echo SEDVersion=3
  echo.
  echo [Options]
  echo PackagePurpose=InstallApp
  echo ShowInstallProgramWindow=1
  echo HideExtractAnimation=1
  echo UseCustomInstallProgram=1
  echo RunProgram=install.bat
  echo InstallPrompt=PRTS Setup
  echo DisplayLicense=
  echo FinishMessage=PRTS has been installed. Run "prts" to open the GUI.
  echo CustomInitialPrompt=
  echo UninstallCmd=
  echo RebootMode=N
  echo.
  echo [SourceFiles]
  echo SourceFiles0=%STAGE%
  echo.
)

echo Building PRTS-Setup.exe with IExpress...
C:\Windows\System32\iexpress.exe /N /Q prts-setup.sed
if not exist "PRTS-Setup.exe" (
  echo [ERROR] IExpress failed to build PRTS-Setup.exe.
  exit /b 1
)
copy /y "PRTS-Setup.exe" "%SRC%PRTS-Setup.exe" >nul
echo.
echo Done: %SRC%PRTS-Setup.exe
echo (The make-dist.sh build produces a ready-made exe without IExpress.)
endlocal
