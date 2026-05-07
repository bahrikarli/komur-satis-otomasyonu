@echo off
title Komur Otomatik Guncelleme Kurulumu
setlocal

cd /d "%~dp0"

set "TASK_NAME=Komur-Otomatik-Guncelleme"
set "TASK_CMD=%~dp0guncelle-ve-baslat.bat"

echo ==========================================
echo KOMUR OTOMATIK GUNCELLEME KURULUMU
echo ==========================================
echo.

if not exist "%TASK_CMD%" (
  echo HATA: guncelle-ve-baslat.bat bulunamadi.
  echo Beklenen konum: %TASK_CMD%
  pause
  exit /b 1
)

echo Gorev olusturuluyor: %TASK_NAME%
schtasks /create /tn "%TASK_NAME%" /tr "\"%TASK_CMD%\"" /sc onlogon /rl highest /f >nul
if errorlevel 1 (
  echo.
  echo HATA: Gorev olusturulamadi.
  echo Bu dosyayi "Yonetici olarak calistir" deneyin.
  pause
  exit /b 1
)

echo.
echo BASARILI: Otomatik guncelleme aktif edildi.
echo Bilgisayar her acildiginda program:
echo - guncellemeyi kontrol eder
echo - guncel kodu alir
echo - programi baslatir
echo.
pause
exit /b 0
