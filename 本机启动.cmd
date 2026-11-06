@echo off
chcp 65001 >nul
cd /d "%~dp0"
"resources\bin\node.exe" "local-start.cjs"
pause
