@echo off
title Komur - Yerel degisiklikleri GitHub'a gonder
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set "ROOT=%~dp0"
set "REPO_SLUG=bahrikarli/komur-satis-otomasyonu"
set "GITHUB_USER=bahrikarli"
set "GTOKEN="
if exist "%ROOT%token.txt" (
  for /f "usebackq tokens=* delims=" %%a in ("%ROOT%token.txt") do set "GTOKEN=%%a"
)

echo ==========================================
echo YEREL KODU GITHUB'A GONDER (add + commit + push)
echo ==========================================
echo.
echo Klasor: %CD%
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: git bulunamadi. Git for Windows kurulu olmali.
  pause
  exit /b 1
)

git status --porcelain 2>nul | findstr /r "." >nul
if errorlevel 1 (
  echo Gonderilecek degisiklik yok ^(calisma agaci temiz^).
  pause
  exit /b 0
)

echo Asagidaki degisiklikler commitlenecek:
git status --short
echo.

set "MSG="
set /p MSG=Commit mesaji yazin ^(bos Enter = otomatik mesaj^): 
if "!MSG!"=="" set "MSG=Yerel guncelleme"

echo.
echo [1/3] git add -A ...
git add -A
if errorlevel 1 (
  echo HATA: git add
  pause
  exit /b 1
)

echo [2/3] git commit ...
git commit -m "!MSG!"
if errorlevel 1 (
  echo.
  echo UYARI: Commit olusmadi ^(bos commit veya hata^). Mesaji kontrol edin veya zaten commitlenmis olabilir.
  pause
  exit /b 1
)

echo [3/3] git push origin main ...
if defined GTOKEN (
  git push "https://%GITHUB_USER%:!GTOKEN!@github.com/%REPO_SLUG%.git" main
) else (
  git push origin main
)
if errorlevel 1 (
  echo.
  echo HATA: push basarisiz. Internet, GitHub girisi veya yetki kontrol edin.
  pause
  exit /b 1
)

echo.
echo Tamam: GitHub'daki main guncellendi.
echo Isyeri PC'lerde guncelle-ve-baslat.bat ile cekilebilir.
timeout /t 3 /nobreak >nul
exit /b 0
