@echo off
title Karaarslan Komur - Sunucu Durdur
cd /d "%~dp0"

echo [1/2] Komur sunucusu durduruluyor...
taskkill /f /im komur-satis-otomasyonu.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo [2/2] Tamam.
echo.
echo Sunucu kapatildi. Yeniden acmak icin baslat.bat veya ACILIS.bat kullanin.
timeout /t 2 /nobreak >nul
exit /b 0
