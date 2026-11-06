@echo off
rem Launch the 2D rig version of Baijie (custom mesh deformation, not Live2D)
set PUPPET_PAGE=rig/index.html
rem Normal launches restore saved size; explicit dimensions are diagnostic-only.
set PUPPET_W=
set PUPPET_H=
start "" "%USERPROFILE%\.dsh\electron\electron.exe" "%~dp0main.js"
