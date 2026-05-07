@echo off
title Komur Surum Cikar
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo KOMUR - TEK TIK SURUM CIKAR
echo ==========================================
echo.

set /p NOTE=Surum notu yazin (orn: yedek ekrani duzeltildi): 
if "%NOTE%"=="" (
  echo HATA: Surum notu bos olamaz.
  pause
  exit /b 1
)

echo.
echo [1/7] Versiyon patch artiriliyor...
npm version patch --no-git-tag-version >nul
if errorlevel 1 (
  echo HATA: npm version patch basarisiz.
  pause
  exit /b 1
)

for /f "tokens=2 delims=:," %%A in ('findstr /i "\"version\"" package.json') do (
  set "VER_RAW=%%A"
)
set "VER=%VER_RAW: =%"
set "VER=%VER:"=%"
set "TAG=v%VER%"

echo Yeni surum: %VER%
echo Yeni tag  : %TAG%
echo.

echo [2/7] Dosyalar stage ediliyor...
git add .
if errorlevel 1 (
  echo HATA: git add basarisiz.
  pause
  exit /b 1
)

echo [3/7] Commit atiliyor...
git commit -m "surum: %NOTE%"
if errorlevel 1 (
  echo HATA: Commit atilamadi.
  pause
  exit /b 1
)

echo [4/7] Tag olusturuluyor...
git tag -a %TAG% -m "komur surum %TAG%"
if errorlevel 1 (
  echo HATA: Tag olusturulamadi. (Belki ayni tag zaten var)
  pause
  exit /b 1
)

echo [5/7] Main branch push...
git push origin main
if errorlevel 1 (
  echo HATA: main push basarisiz.
  pause
  exit /b 1
)

echo [6/7] Tag push...
git push origin %TAG%
if errorlevel 1 (
  echo HATA: Tag push basarisiz.
  pause
  exit /b 1
)

echo [7/7] Tamamlandi.
echo Basarili! Surum %VER% yayinlandi.
echo.
pause
exit /b 0
