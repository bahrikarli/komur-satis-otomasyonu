@echo off
title Karaarslan Komur Baslatici

:: 1. EMNİYET: Dosyanin oldugu asil klasore gitmeyi garantiye al (Kisayol problemini cozer)
cd /d "%~dp0"

echo [1/3] Eski sistemler temizleniyor...
taskkill /f /im node.exe >nul 2>&1

echo [2/3] Kasa sunucusu baslatiliyor...
:: /MIN komutu siyah ekranı direk gorev cubuguna kucultur, .bat kapansa bile sunucu yasamaya devam eder!
start /MIN node index.js

echo [3/3] Veritabanina baglanmasi bekleniyor (4 saniye)...
:: Veritabani (MSSQL) baglantisi uzun surebiliyor, o yuzden 2 yerine 4 saniye bekliyoruz
timeout /t 4 /nobreak >nul

echo Dukkan aciliyor...
start http://localhost:3007

exit