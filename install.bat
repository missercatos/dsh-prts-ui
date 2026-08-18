@echo off
setlocal
REM PRTS integrated-package installer (Windows) — launcher for the
REM cross-platform wizard: dsh check/download (with progress), plugin
REM selection (installed ones greyed), PRTS UI install + theme applied.
set "SRC=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org
  echo         ^(or https://npmmirror.com/mirrors/node/ in mainland China^) and re-run.
  pause
  exit /b 1
)
if "%~1"=="" (
  node "%SRC%wizard\server.mjs"
) else (
  set "PRTS_WIZARD_TGZ=%~1"
  node "%SRC%wizard\server.mjs"
)
endlocal
