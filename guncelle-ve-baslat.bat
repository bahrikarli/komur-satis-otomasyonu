@echo off
title Komur Guncelle ve Baslat
setlocal

:: Her zaman bu dosyanin bulundugu klasorde calis
cd /d "%~dp0"

echo ==========================================
echo KOMUR - GUNCELLE VE BASLAT
echo ==========================================
echo.

echo [1/4] GitHub'dan guncel kod aliniyor...
git pull origin main
if errorlevel 1 (
  echo.
  echo HATA: Git guncellemesi basarisiz.
  echo Internet, GitHub erisimi veya yetki kontrol edin.
  pause
  exit /b 1
)

echo.
echo [2/4] Paketler kontrol ediliyor...
npm install
if errorlevel 1 (
  echo.
  echo HATA: npm install basarisiz.
  pause
  exit /b 1
)

echo.
echo [3/4] Sunucu yeniden baslatiliyor...
cmd /c ""%~dp0baslat.bat""
if errorlevel 1 (
  echo.
  echo HATA: Uygulama baslatilirken sorun olustu.
  pause
  exit /b 1
)

echo.
echo [4/4] Islem tamamlandi.
echo Uygulama guncel surumle acildi.
timeout /t 2 /nobreak >nul
exit /b 0
