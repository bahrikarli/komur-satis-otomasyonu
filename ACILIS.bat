@echo off
cd /d "%~dp0"
if exist "%~dp0ACILIS.vbs" (
  start "" wscript.exe "%~dp0ACILIS.vbs"
  exit /b 0
)
call "%~dp0baslat.bat"
