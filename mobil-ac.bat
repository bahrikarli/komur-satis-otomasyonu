@echo off
title Komur - Mobil Baglanti Yardimcisi
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=3017"
if exist "%~dp0scripts\read-port.js" (
  for /f "usebackq delims=" %%p in (`node "%~dp0scripts\read-port.js" "%~dp0" 2^>nul`) do set "PORT=%%p"
)

if not exist "%~dp0public\mobil\index.html" (
  echo.
  echo HATA: public\mobil klasoru yok.
  echo Once musteri-paketi-olustur.bat veya yeni ZIP kurun.
  echo.
  pause
  exit /b 1
)

set "MOBIL_PC=http://localhost:%PORT%/mobil/"
set "SUNUCU_IP="

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$a=Get-NetIPAddress -AddressFamily IPv4|Where-Object{$_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown'}|Select-Object -First 1 -ExpandProperty IPAddress;if($a){$a}else{''}"`) do set "SUNUCU_IP=%%i"

if not defined SUNUCU_IP set "SUNUCU_IP=SUNUCU_IP_BURAYA"
set "MOBIL_TEL=http://%SUNUCU_IP%:%PORT%/mobil/"

echo.
echo ==========================================
echo   KOMUR MOBIL
echo ==========================================
echo Bilgisayar: %MOBIL_PC%
echo Telefon:    %MOBIL_TEL%
echo ==========================================

start "" "%MOBIL_PC%"
if /I not "%SUNUCU_IP%"=="SUNUCU_IP_BURAYA" (
  start "" "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=%MOBIL_TEL%"
)
pause
endlocal
