@echo off
setlocal
set "ROOT=%~dp0"
set "EXE=komur-satis-otomasyonu.exe"
cd /d "%ROOT%"

if not exist "%ROOT%dist\%EXE%" (
  echo HATA: dist\%EXE% yok. Once: npm run build:exe
  pause
  exit /b 1
)

copy /y "%ROOT%dist\%EXE%" "%ROOT%%EXE%" >nul
echo OK: %ROOT%%EXE% guncellendi.
pause
