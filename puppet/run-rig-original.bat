@echo off
setlocal
rem Compare with the complete original body; independent outer locks are disabled.
set PUPPET_PAGE=rig/index.html?layers=0
set PUPPET_W=240
set PUPPET_H=348
start "" "%USERPROFILE%\.dsh\electron\electron.exe" "%~dp0main.js"
endlocal
