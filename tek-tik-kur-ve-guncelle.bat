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

echo [1/3] Schedule task install...
schtasks /create /tn "%TASK_NAME%" /tr "\"%SELF%\" --auto" /sc onlogon /rl highest /f >nul
if errorlevel 1 (
  echo ERROR: Task create failed. Run as Administrator.
  pause
  exit /b 1
)

echo [2/3] Update from GitHub...
git stash push -u -m "auto-update-temp-stash" >nul 2>&1
git pull origin main
if errorlevel 1 (
  echo ERROR: git pull failed.
  echo Tip: local changes were detected; trying one more stash...
  git stash push -u -m "auto-update-temp-stash-retry" >nul 2>&1
  git pull origin main
)
if errorlevel 1 (
  echo ERROR: git pull still failed.
  pause
  exit /b 1
)

echo [3/3] Install deps and start...
npm install
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

rem npm install can touch lockfile; keep next pull clean
git checkout -- package-lock.json >nul 2>&1

cmd /c ""%~dp0baslat.bat""
echo DONE.
pause
exit /b 0

:AUTO_MODE
git stash push -u -m "auto-update-temp-stash" >nul 2>&1
git pull origin main >nul 2>&1
if errorlevel 1 exit /b 1
npm install >nul 2>&1
if errorlevel 1 exit /b 1
git checkout -- package-lock.json >nul 2>&1
cmd /c ""%~dp0baslat.bat"" >nul 2>&1
exit /b 0
