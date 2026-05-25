@echo off
:: KARAARSLAN KOMUR - Windows Guvenlik Duvari: TCP port giris izni
:: Yonetici olarak calistirin: sag tik -> Yonetici olarak calistir

setlocal EnableDelayedExpansion
title Komur - Guvenlik Duvari

set "PORT=3017"
set "KURAL_ADI=Komur Satis Otomasyonu (TCP %PORT%)"

cd /d "%~dp0.."
if exist "scripts\read-port.js" (
  for /f "usebackq delims=" %%p in (`node "%~dp0read-port.js" "%~dp0.." 2^>nul`) do set "PORT=%%p"
)
set "KURAL_ADI=Komur Satis Otomasyonu (TCP %PORT%)"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo HATA: Bu dosyayi YONETICI olarak calistirin.
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="%KURAL_ADI%" >nul 2>&1
netsh advfirewall firewall add rule name="%KURAL_ADI%" dir=in action=allow protocol=TCP localport=%PORT% profile=any enable=yes

if errorlevel 1 (
  echo HATA: Kural eklenemedi.
  pause
  exit /b 1
)

echo BASARILI: TCP port %PORT% acildi.
pause
exit /b 0
