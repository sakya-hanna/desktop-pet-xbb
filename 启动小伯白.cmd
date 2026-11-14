@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "ELECTRON_EXTRA_LAUNCH_ARGS="
if not exist "%USERPROFILE%\.dsh\electron\electron.exe" (
  echo Existing Electron runtime was not found.
  pause
  exit /b 1
)
start "" "%USERPROFILE%\.dsh\electron\electron.exe" "%~dp0launch.cjs"
endlocal
