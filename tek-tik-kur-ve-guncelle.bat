@echo off
setlocal
cd /d "%~dp0"

set "TASK_NAME=Komur-Otomatik-Guncelleme"
set "SELF=%~f0"

if /i "%~1"=="--auto" goto AUTO_MODE

title Komur Tek Tik Kur ve Guncelle
echo ==========================================
echo KOMUR - TEK TIK KUR VE GUNCELLE
echo ==========================================
echo.

echo [1/3] Otomatik guncelleme gorevi kuruluyor...
schtasks /create /tn "%TASK_NAME%" /tr "\"%SELF%\" --auto" /sc onlogon /rl highest /f >nul
if errorlevel 1 (
  echo.
  echo HATA: Gorev olusturulamadi.
  echo Bu dosyayi "Yonetici olarak calistir" deneyin.
  pause
  exit /b 1
)
echo BASARILI: Otomatik guncelleme aktif edildi.
echo.

echo [2/3] GitHub'dan guncel kod aliniyor...
git pull origin main
if errorlevel 1 (
  echo.
  echo HATA: Git guncellemesi basarisiz.
  echo Internet/GitHub erisimi kontrol edin.
  pause
  exit /b 1
)

echo.
echo [3/3] Paketler kontrol edilip program baslatiliyor...
npm install
if errorlevel 1 (
  echo.
  echo HATA: npm install basarisiz.
  pause
  exit /b 1
)

cmd /c ""%~dp0baslat.bat""
echo.
echo Islem tamamlandi. Program guncel surumle acildi.
pause
exit /b 0

:AUTO_MODE
git pull origin main >nul 2>&1
if errorlevel 1 exit /b 1
npm install >nul 2>&1
if errorlevel 1 exit /b 1
cmd /c ""%~dp0baslat.bat"" >nul 2>&1
exit /b 0
