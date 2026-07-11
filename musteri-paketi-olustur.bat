@echo off
setlocal EnableDelayedExpansion
title Komur - Musteri Paketi Olustur
set "ROOT=%~dp0"
set "EXE_NAME=komur-satis-otomasyonu"
set "PAKET=%ROOT%musteri-paketi"
set "DIST_EXE=%ROOT%dist\%EXE_NAME%.exe"
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
  goto :paket_hazirla
)

if /I "%~1"=="hizli" (
  echo [1] Hizli mod: EXE yeniden DERLENMEZ, sadece public + bat kopyalanir.
  if not exist "%DIST_EXE%" (
    echo HATA: dist\%EXE_NAME%.exe yok. Once normal calistirin veya: npm run build:exe
    exit /b 1
  )
  goto :paket_hazirla
)

echo [1] EXE yeniden derleniyor ^(index.js degisiklikleri pakete girer^)...
taskkill /F /IM "%EXE_NAME%.exe" >nul 2>nul
call npm run build:exe
if errorlevel 1 (
  echo HATA: npm run build:exe basarisiz.
  exit /b 1
)
if not exist "%DIST_EXE%" (
  echo HATA: Build sonrasi dist\%EXE_NAME%.exe bulunamadi.
  exit /b 1
)
for %%F in ("%DIST_EXE%") do echo    OK: dist\%%~nxF  ^(%%~zF byte, %%~tF^)

:paket_hazirla
set "VER="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "VER=%%i"
if "%VER%"=="" set "VER=0.0.0"

echo [2] Paket klasoru hazirlaniyor: %PAKET%
if exist "%PAKET%" rmdir /s /q "%PAKET%"
mkdir "%PAKET%"
mkdir "%PAKET%\public"
mkdir "%PAKET%\scripts"

copy /y "%DIST_EXE%" "%PAKET%\" >nul
if errorlevel 1 (
  echo HATA: EXE kopyalanamadi. Dosya acik olabilir ^(ACILIS.bat kapatin^).
  exit /b 1
)
for %%F in ("%PAKET%\%EXE_NAME%.exe") do echo    OK: paket\%%~nxF  ^(%%~zF byte, %%~tF^)

xcopy "%ROOT%public" "%PAKET%\public\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo HATA: public klasoru kopyalanamadi.
  exit /b 1
)
echo    OK: public\

if exist "%ROOT%baslat.bat" copy /y "%ROOT%baslat.bat" "%PAKET%\" >nul
if exist "%ROOT%durdur.bat" copy /y "%ROOT%durdur.bat" "%PAKET%\" >nul
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

if /I "%~1"=="nopause" goto :paket_bitti
if /I "%~2"=="nopause" goto :skip_prompt

echo.
set "HEDEF=C:\musteri-paketi"
set /p KOPYA=%HEDEF% klasorune de kopyalansin mi? (E/H): 
if /I "!KOPYA!"=="E" (
  echo [3] %HEDEF% guncelleniyor...
  if not exist "%HEDEF%" mkdir "%HEDEF%"
  if exist "%HEDEF%\.env" (
    echo    .env korunuyor ^(ustune yazilmiyor^)
    copy /y "%HEDEF%\.env" "%ROOT%_env_musteri_bak.tmp" >nul
  )
  xcopy "%PAKET%\*" "%HEDEF%\" /E /I /Y /Q >nul
  if exist "%ROOT%_env_musteri_bak.tmp" (
    copy /y "%ROOT%_env_musteri_bak.tmp" "%HEDEF%\.env" >nul
    del /f /q "%ROOT%_env_musteri_bak.tmp" >nul
  )
  for %%F in ("%HEDEF%\%EXE_NAME%.exe") do echo    OK: %%F  ^(%%~zF byte, %%~tF^)
)

:skip_prompt
if exist "%ROOT%scripts\masaustu-kisayol.ps1" (
  echo [4] Masaustu kisayolu...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\masaustu-kisayol.ps1" -HedefKlasor "%PAKET%"
)

:paket_bitti
echo.
echo ============================================
echo   TAMAM
echo ============================================
echo   Paket: %PAKET%
echo   Musteri: ACILIS.bat veya masaustu kisayolu
echo   Durdur: durdur.bat
echo   Mobil:  mobil-ac.bat
echo.
echo   Sadece arayuz ^(public^), EXE dokunma:  musteri-paketi-olustur.bat hizli
echo   Yayin + paket birlikte:           musteri-paketi-olustur.bat release
echo ============================================
if /I not "%~1"=="nopause" if /I not "%~2"=="nopause" pause
endlocal
