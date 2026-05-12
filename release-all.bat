@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "REPO=bahrikarli/komur-satis-otomasyonu"
set "EXE_NAME=komur-satis-otomasyonu"
cd /d "%ROOT%"

:: ────────────────────────────────────────────────────
:: GH_TOKEN kontrolu
:: ────────────────────────────────────────────────────
if "%GH_TOKEN%"=="" (
  if exist "%ROOT%.gh-token" (
    set /p GH_TOKEN=<"%ROOT%.gh-token"
  )
)
if "%GH_TOKEN%"=="" (
  echo.
  echo HATA: GH_TOKEN ayarli degil.
  echo Once terminalde:  set GH_TOKEN=ghp_XXXXXXXXXXXXX
  echo Veya .gh-token dosyasina token yazin.
  exit /b 1
)

:: ────────────────────────────────────────────────────
:: [1/7] Version hesapla veya parametreden al
:: ────────────────────────────────────────────────────
if "%~1"=="" (
  for /f "usebackq delims=" %%i in (`node -e "const p=require('./package.json'); const v=String(p.version||'0.0.0').split('.').map(Number); v[2]=(v[2]||0)+1; console.log(v.join('.'));"`) do set "VER=%%i"
) else (
  set "VER=%~1"
)

if "%VER%"=="" (
  echo HATA: Version hesaplanamadi.
  exit /b 1
)

echo.
echo ============================================
echo   RELEASE v%VER% - Komur Satis Otomasyonu
echo ============================================

:: ────────────────────────────────────────────────────
:: [1/7] package.json + HTML version guncelle
:: ────────────────────────────────────────────────────
echo.
echo [1/7] Version %VER% olarak ayarlaniyor...
node "%ROOT%scripts\set-version.js" "%VER%"
if errorlevel 1 (
  echo HATA: package version guncellenemedi.
  exit /b 1
)
set "PKG_VER="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "PKG_VER=%%i"
if /I not "%PKG_VER%"=="%VER%" (
  echo HATA: package.json version dogrulamasi basarisiz. Okunan: %PKG_VER%
  exit /b 1
)
echo    OK: package.json = %VER%

:: ────────────────────────────────────────────────────
:: [2/7] EXE build (pkg - eski sistem icin)
:: ────────────────────────────────────────────────────
echo.
echo [2/7] EXE build aliniyor (pkg)...
taskkill /F /IM "%EXE_NAME%.exe" >nul 2>nul
call npm run build:exe
if errorlevel 1 (
  echo HATA: EXE build basarisiz.
  exit /b 1
)
echo    OK: dist\%EXE_NAME%.exe

:: ────────────────────────────────────────────────────
:: [3/7] Release klasoru + ZIP (eski sistem)
:: ────────────────────────────────────────────────────
echo.
echo [3/7] Release klasoru + ZIP hazirlaniyor...
set "RELEASE_DIR=%ROOT%release-v%VER%"
set "ZIP_FILE=%ROOT%%EXE_NAME%-%VER%.zip"
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\public"
copy /y "%ROOT%dist\%EXE_NAME%.exe" "%RELEASE_DIR%\" >nul
xcopy "%ROOT%public" "%RELEASE_DIR%\public" /E /I /Y >nul
if exist "%ROOT%guncelle-ve-baslat.bat" copy /y "%ROOT%guncelle-ve-baslat.bat" "%RELEASE_DIR%\" >nul
if exist "%ROOT%baslat.bat" copy /y "%ROOT%baslat.bat" "%RELEASE_DIR%\" >nul
if exist "%ROOT%.env.ornek" copy /y "%ROOT%.env.ornek" "%RELEASE_DIR%\.env" >nul
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"
powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"
if errorlevel 1 (
  echo HATA: ZIP olusturulamadi.
  exit /b 1
)
echo    OK: %ZIP_FILE%

:: ────────────────────────────────────────────────────
:: [4/7] guncelleme.json manifest
:: ────────────────────────────────────────────────────
echo.
echo [4/7] Guncelleme manifest dosyalari olusturuluyor...
(
echo {
echo   "version": "%VER%",
echo   "repo": "%REPO%",
echo   "tag": "v%VER%",
echo   "assetName": "%EXE_NAME%-%VER%.zip",
echo   "notes": "v%VER% guncellemesi"
echo }
) > "%ROOT%guncelleme.json"
copy /y "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" >nul
echo    OK: guncelleme.json + guncelleme-%VER%.json

:: ────────────────────────────────────────────────────
:: [5/7] GitHub Release: ZIP + manifest yukle
:: ────────────────────────────────────────────────────
echo.
echo [5/7] GitHub Release (ZIP + manifest) yukleniyor...
where gh >nul 2>nul
if errorlevel 1 (
  echo    UYARI: gh CLI bulunamadi, ZIP yukleme atlaniyor.
  echo    Manuel yukle: %ZIP_FILE% + guncelleme.json
  goto electron_build
)
gh release view "v%VER%" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
  gh release create "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" --repo "%REPO%" --title "v%VER%" --notes "v%VER% guncellemesi"
) else (
  gh release upload "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" --repo "%REPO%" --clobber
)
if errorlevel 1 (
  echo    UYARI: ZIP release yuklenemedi, devam ediliyor...
) else (
  echo    OK: ZIP + manifest GitHub'a yuklendi.
)

:: ────────────────────────────────────────────────────
:: [6/7] Electron Desktop build + publish
:: ────────────────────────────────────────────────────
:electron_build
echo.
echo [6/7] Electron Desktop paketi olusturuluyor ve yayinlaniyor...
taskkill /F /IM "Karaarslan Komur.exe" >nul 2>nul
set CSC_IDENTITY_AUTO_DISCOVERY=false

for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "TS=%%d"
call npx electron-builder --win nsis --publish always --config.directories.output=dist-desktop-%TS%
if errorlevel 1 (
  echo.
  echo UYARI: Electron Desktop publish basarisiz!
  echo ZIP release basarili, sadece desktop paketi hatali.
  goto done
)
echo    OK: Electron Setup GitHub'a yuklendi.

:: ────────────────────────────────────────────────────
:: [7/7] Git commit + push
:: ────────────────────────────────────────────────────
:done
echo.
echo [7/7] Git commit (guncelleme.json + package.json)...
git add guncelleme.json guncelleme-%VER%.json package.json package-lock.json public/index.html >nul 2>nul
git commit -m "v%VER% release" >nul 2>nul
git tag -a "v%VER%" -m "komur surum v%VER%" >nul 2>nul
git push origin main >nul 2>nul
git push origin "v%VER%" >nul 2>nul
if errorlevel 1 (
  echo    UYARI: Git push basarisiz veya atlanildi.
) else (
  echo    OK: Git push + tag tamamlandi.
)

echo.
echo ============================================
echo   BASARILI: v%VER% tum kanallar yayinlandi!
echo ============================================
echo.
echo   ZIP (eski sistem):     %ZIP_FILE%
echo   Electron Setup:        dist-desktop-%TS%\
echo   GitHub Release:        github.com/%REPO%/releases/tag/v%VER%
echo.
endlocal
