@echo off
title Komur Guncelle ve Baslat
setlocal EnableDelayedExpansion

:: Bu dosya repoda durur; isyeri PC'sine tum klasorle birlikte kopyalanir.
:: AMAÇ: GitHub'daki son kodu cekip npm + baslat.
:: GUVENLIK: Yerel commitlenmemis / kaydedilmemis degisiklik varsa git pull YAPILMAZ
:: ^(kayip veya catisma riski^). Once commit+push veya degisiklikleri geri alin.
:: Istisna ^(risk size ait^): cmd de once  set KOMUR_GUNCELLEME_ZORLA=1
:: Git HTTPS: token.txt varsa ^(tek satir, .gitignore'da^) otomatik kimlik dogrulama.

set "ROOT=%~dp0"
set "REPO_SLUG=bahrikarli/komur-satis-otomasyonu"
set "GITHUB_USER=bahrikarli"
set "GTOKEN="
if exist "%ROOT%token.txt" (
  for /f "usebackq tokens=* delims=" %%a in ("%ROOT%token.txt") do set "GTOKEN=%%a"
)

:: Her zaman bu dosyanin bulundugu klasorde calis
cd /d "%ROOT%"

echo ==========================================
echo KOMUR - GUNCELLE VE BASLAT
echo ==========================================
echo.

:: Yerel degisiklik var mi? (temiz: findstr eslesmez ^> errorlevel 1)
git status --porcelain 2>nul | findstr /r "." >nul
if errorlevel 1 goto GIT_PULL

if /I "%KOMUR_GUNCELLEME_ZORLA%"=="1" (
  echo *** KOMUR_GUNCELLEME_ZORLA=1 *** git pull riski size ait, devam ediliyor...
  echo.
  goto GIT_PULL
)

echo *** GUNCELLEME IPTAL ***
echo Bu klasorde commitlenmemis veya izlenmeyen dosya degisiklikleri var.
echo git pull YAPILMADI ^(yerel isinizin uzerine yazilmasin diye^).
echo.
echo Ne yapmalisiniz:
echo   - Gelistirme PC: kaydet-ve-githuba-gonder.bat veya git commit + git push
echo   - Gecici dosyalari silin / .gitignore a ekleyin
echo   - Gercekten bu halde cekmek istiyorsaniz ^(onerilmez^):
echo       cmd:  set KOMUR_GUNCELLEME_ZORLA=1
echo       sonra bu bat'i yeniden calistirin.
echo.
pause
exit /b 1

:GIT_PULL
echo [1/4] GitHub'dan guncel kod aliniyor...
if defined GTOKEN (
  git pull "https://%GITHUB_USER%:!GTOKEN!@github.com/%REPO_SLUG%.git" main
) else (
  git pull origin main
)
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
