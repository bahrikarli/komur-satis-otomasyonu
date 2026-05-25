@echo off
chcp 65001 >nul 2>&1
title Komur - Uzak Sunucu (Masaustu)
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=3017"
if exist "%~dp0scripts\read-port.js" (
  for /f "usebackq delims=" %%p in (`node "%~dp0scripts\read-port.js" "%~dp0" 2^>nul`) do set "PORT=%%p"
)

if not exist "%~dp0uzak-sunucu.txt" (
  echo.
  echo [BILGI] uzak-sunucu.txt bulunamadi.
  if exist "%~dp0uzak-sunucu.ornek.txt" (
    copy /Y "%~dp0uzak-sunucu.ornek.txt" "%~dp0uzak-sunucu.txt" >nul
    echo Ornek dosya kopyalandi: uzak-sunucu.txt
    echo Lutfen icindeki IP adresini uzak kasa PC''ye gore duzenleyin.
    echo.
    notepad "%~dp0uzak-sunucu.txt"
    echo Duzenledikten sonra bu dosyayi tekrar calistirin.
    pause
    exit /b 0
  )
  echo Lutfen proje klasorune uzak-sunucu.txt olusturun ^(tek satir: IP^).
  pause
  exit /b 1
)

for /f "usebackq delims=" %%u in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uzak-sunucu-oku.ps1" -Kok "%~dp0" -VarsayilanPort %PORT% 2^>nul`) do set "UZAK_URL=%%u"

if not defined UZAK_URL (
  echo.
  echo HATA: uzak-sunucu.txt icinde gecerli IP veya adres yok.
  echo Ornek: 192.168.1.10  veya  http://192.168.1.10:3017
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uzak-ac.ps1" -Url "%UZAK_URL%"
set "PS_ERR=%ERRORLEVEL%"
if not "%PS_ERR%"=="0" pause
endlocal
exit /b %PS_ERR%
