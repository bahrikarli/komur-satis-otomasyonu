@echo off
setlocal EnableDelayedExpansion
title Komur - Musteri Paketi Olustur
set "ROOT=%~dp0"
set "EXE_NAME=komur-satis-otomasyonu"
set "PAKET=%ROOT%musteri-paketi"
cd /d "%ROOT%"

echo.
echo ============================================
echo   MUSTERI PAKETI OLUSTUR
echo ============================================
echo.

if /I "%~1"=="release" (
  echo [0] Once release-all calistiriliyor...
  call "%ROOT%release-all.bat" %~2
  if errorlevel 1 (
    echo HATA: release-all basarisiz.
    exit /b 1
  )
  echo.
)

set "VER="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "VER=%%i"
if "%VER%"=="" set "VER=0.0.0"

if not exist "%ROOT%dist\%EXE_NAME%.exe" (
  echo [1] EXE yok, build aliniyor...
  call npm run build:exe
  if errorlevel 1 (
    echo HATA: npm run build:exe basarisiz.
    exit /b 1
  )
)
echo    OK: dist\%EXE_NAME%.exe

echo [2] Paket klasoru hazirlaniyor: %PAKET%
if exist "%PAKET%" rmdir /s /q "%PAKET%"
mkdir "%PAKET%"
mkdir "%PAKET%\public"
mkdir "%PAKET%\scripts"

copy /y "%ROOT%dist\%EXE_NAME%.exe" "%PAKET%\" >nul
xcopy "%ROOT%public" "%PAKET%\public\" /E /I /Y /Q >nul

if exist "%ROOT%baslat.bat" copy /y "%ROOT%baslat.bat" "%PAKET%\" >nul
if exist "%ROOT%baslat.vbs" copy /y "%ROOT%baslat.vbs" "%PAKET%\" >nul
if exist "%ROOT%ACILIS.bat" copy /y "%ROOT%ACILIS.bat" "%PAKET%\" >nul
if exist "%ROOT%ACILIS.vbs" copy /y "%ROOT%ACILIS.vbs" "%PAKET%\" >nul
if exist "%ROOT%guncelle-ve-baslat.bat" copy /y "%ROOT%guncelle-ve-baslat.bat" "%PAKET%\" >nul
if exist "%ROOT%mobil-ac.bat" copy /y "%ROOT%mobil-ac.bat" "%PAKET%\" >nul
if exist "%ROOT%Kisayol-Olustur.bat" copy /y "%ROOT%Kisayol-Olustur.bat" "%PAKET%\" >nul
if exist "%ROOT%.env.ornek" copy /y "%ROOT%.env.ornek" "%PAKET%\.env.ornek" >nul

if exist "%ROOT%scripts\read-port.js" copy /y "%ROOT%scripts\read-port.js" "%PAKET%\scripts\" >nul
if exist "%ROOT%scripts\masaustu-kisayol.ps1" copy /y "%ROOT%scripts\masaustu-kisayol.ps1" "%PAKET%\scripts\" >nul
if exist "%ROOT%scripts\guvenlik-duvari-port-ac.bat" copy /y "%ROOT%scripts\guvenlik-duvari-port-ac.bat" "%PAKET%\scripts\" >nul

echo %VER%> "%PAKET%\surum.txt"

echo    OK: musteri-paketi\ hazir (surum %VER%)

echo.
set "HEDEF=C:\musteri-paketi"
set /p KOPYA=%HEDEF% klasorune de kopyalansin mi? (E/H): 
if /I "!KOPYA!"=="E" (
  echo [3] %HEDEF% guncelleniyor...
  if not exist "%HEDEF%" mkdir "%HEDEF%"
  xcopy "%PAKET%\*" "%HEDEF%\" /E /I /Y /Q >nul
  echo    OK: %HEDEF%
)

if exist "%ROOT%scripts\masaustu-kisayol.ps1" (
  echo [4] Masaustu kisayolu...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\masaustu-kisayol.ps1" -HedefKlasor "%PAKET%"
)

echo.
echo ============================================
echo   TAMAM
echo ============================================
echo   Paket: %PAKET%
echo   Musteri: ACILIS.bat veya masaustu kisayolu
echo   Mobil:  mobil-ac.bat
echo.
echo   Yayin + paket birlikte:  musteri-paketi-olustur.bat release
echo ============================================
pause
endlocal
