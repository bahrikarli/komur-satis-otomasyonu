@echo off
title Karaarslan Komur Baslatici

:: 1. EMNİYET: Dosyanin oldugu asil klasore gitmeyi garantiye al (Kisayol problemini cozer)
cd /d "%~dp0"

if not exist "C:\komurbackup" mkdir "C:\komurbackup"

set "PORT=3017"
if exist "%~dp0scripts\read-port.js" (
  for /f "usebackq delims=" %%p in (`node "%~dp0scripts\read-port.js" "%~dp0" 2^>nul`) do set "PORT=%%p"
)

echo [1/3] Eski sistemler temizleniyor...
taskkill /f /im komur-satis-otomasyonu.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo [2/3] Kasa sunucusu baslatiliyor...
if exist "%~dp0komur-satis-otomasyonu.exe" (
  start /MIN "" "%~dp0komur-satis-otomasyonu.exe"
) else if exist "%~dp0dist\komur-satis-otomasyonu.exe" (
  start /MIN "" "%~dp0dist\komur-satis-otomasyonu.exe"
) else if exist "%~dp0index.js" (
  start /MIN cmd /c "cd /d "%~dp0" && node index.js"
) else (
  echo HATA: komur-satis-otomasyonu.exe veya index.js bulunamadi.
  pause
  exit /b 1
)

echo [3/3] Veritabanina baglanmasi bekleniyor (4 saniye)...
timeout /t 4 /nobreak >nul

echo Dukkan aciliyor...
start http://localhost:%PORT%

exit