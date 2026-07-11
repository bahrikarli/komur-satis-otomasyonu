@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "REPO=bahrikarli/komur-satis-otomasyonu"
set "EXE_NAME=komur-satis-otomasyonu"
cd /d "%ROOT%"

:: ────────────────────────────────────────────────────
:: GH_TOKEN kontrolu (gh release icin)
:: token.txt varsa HER ZAMAN dosyadan okunur ^(Windows taki eski GH_TOKEN ortam degiskenini ezer^).
:: Yoksa: ortam degiskeni GH_TOKEN ^> .gh-token
:: release-all.bat icine token yazmayin; local-release.bat ornek: .gitignore
if exist "%ROOT%token.txt" (
  set "GH_TOKEN="
  for /f "usebackq tokens=* delims=" %%a in ("%ROOT%token.txt") do set "GH_TOKEN=%%a"
) else (
  if "%GH_TOKEN%"=="" (
    if exist "%ROOT%.gh-token" (
      set /p GH_TOKEN=<"%ROOT%.gh-token"
    )
  )
)
if "!GH_TOKEN!"=="" (
  echo.
  echo HATA: GH_TOKEN ayarli degil.
  echo Once terminalde:  set GH_TOKEN=ghp_XXXXXXXXXXXXX
  echo Veya token.txt / .gh-token dosyasina token yazin ^(token.txt .gitignore'da^).
  echo Veya: local-release.example.bat dosyasini local-release.bat olarak kopyalayip
  echo        icine token yazin ^(local-release.bat git e gitmez^).
  exit /b 1
)
for /f "usebackq delims=" %%a in (`node "%ROOT%scripts\trim-gh-token.js"`) do set "GH_TOKEN=%%a"
set "GITHUB_TOKEN=!GH_TOKEN!"
if "!GH_TOKEN!"=="" (
  echo HATA: Token bos ^(token.txt / .gh-token / ortam degiskeni^).
  exit /b 1
)

:: ────────────────────────────────────────────────────
:: Version hesapla veya parametreden al
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
echo   (pkg ZIP + GitHub Release; Electron YOK)
echo ============================================

:: ────────────────────────────────────────────────────
:: [1/6] package.json + HTML version guncelle
:: ────────────────────────────────────────────────────
echo.
echo [1/6] Version %VER% olarak ayarlaniyor...
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
:: [2/6] EXE build (pkg)
:: ────────────────────────────────────────────────────
echo.
echo [2/6] EXE build aliniyor (pkg)...
taskkill /F /IM "%EXE_NAME%.exe" >nul 2>nul
call npm run build:exe
if errorlevel 1 (
  echo HATA: EXE build basarisiz.
  exit /b 1
)
echo    OK: dist\%EXE_NAME%.exe

:: ────────────────────────────────────────────────────
:: [3/6] Release klasoru + ZIP
:: ────────────────────────────────────────────────────
echo.
echo [3/6] Release klasoru + ZIP hazirlaniyor...
set "RELEASE_DIR=%ROOT%release-v%VER%"
set "ZIP_FILE=%ROOT%%EXE_NAME%-%VER%.zip"
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\public"
copy /y "%ROOT%dist\%EXE_NAME%.exe" "%RELEASE_DIR%\" >nul
xcopy "%ROOT%public" "%RELEASE_DIR%\public" /E /I /Y >nul
if exist "%ROOT%guncelle-ve-baslat.bat" copy /y "%ROOT%guncelle-ve-baslat.bat" "%RELEASE_DIR%\" >nul
if exist "%ROOT%baslat.bat" copy /y "%ROOT%baslat.bat" "%RELEASE_DIR%\" >nul
if exist "%ROOT%durdur.bat" copy /y "%ROOT%durdur.bat" "%RELEASE_DIR%\" >nul
if exist "%ROOT%.env.ornek" copy /y "%ROOT%.env.ornek" "%RELEASE_DIR%\.env" >nul
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"
powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"
if errorlevel 1 (
  echo HATA: ZIP olusturulamadi.
  exit /b 1
)
echo    OK: %ZIP_FILE%

:: ────────────────────────────────────────────────────
:: [4/6] guncelleme.json manifest
:: ────────────────────────────────────────────────────
echo.
echo [4/6] Guncelleme manifest dosyalari olusturuluyor...
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
:: [5/6] GitHub Release: ZIP + manifest yukle
:: ────────────────────────────────────────────────────
echo.
echo [5/6] GitHub Release (ZIP + manifest) yukleniyor...
where gh >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe" set "PATH=%LOCALAPPDATA%\Programs\GitHub CLI;%PATH%"
where gh >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "PATH=%ProgramFiles%\GitHub CLI;%PATH%"
where gh >nul 2>nul
if errorlevel 1 (
  echo    UYARI: gh CLI bulunamadi, ZIP yukleme atlaniyor.
  echo    Manuel yukle: %ZIP_FILE% + guncelleme.json
  goto GIT_RELEASE_DONE
)
:: Token: Node ile Bearer + REST (gh den bagimsiz; fine-grained /user sorunu yok)
node "%ROOT%scripts\github-repo-token-check.js" "%REPO%" >nul 2>nul
if not errorlevel 1 goto GH_AUTH_READY

echo    UYARI: token.txt / GH_TOKEN API ile dogrulanamadi; "gh auth login" deneniyor...
set "GH_TOKEN_BAK=!GH_TOKEN!"
set "GITHUB_TOKEN_BAK=!GITHUB_TOKEN!"
set "GH_TOKEN="
set "GITHUB_TOKEN="
gh api "repos/%REPO%" --jq .name >nul 2>nul
if not errorlevel 1 (
  echo    OK: ZIP icin GitHub CLI oturumu kullanilacak ^(token.txt atlandi^).
  goto GH_AUTH_READY
)
set "GH_TOKEN=!GH_TOKEN_BAK!"
set "GITHUB_TOKEN=!GITHUB_TOKEN_BAK!"
echo    HATA: GitHub kimlik dogrulamasi basarisiz ^(401/403^). ZIP yuklenemedi.
echo    OZET: token.txt icindeki PAT GitHub API tarafindan reddedildi ^(401^). Yeni token, tek satir.
echo    ---- Asagidaki cikti token metnini GOSTERMEZ; paylasmayin ----
node "%ROOT%scripts\github-repo-token-check.js" "%REPO%"
echo    ---- gh ^(ortam tokeni gecici kapali; asil CLI oturumu^) ----
set "GH_TOKEN="
set "GITHUB_TOKEN="
gh auth status 2>&1
set "GH_TOKEN=!GH_TOKEN_BAK!"
set "GITHUB_TOKEN=!GITHUB_TOKEN_BAK!"
echo    ------------------------------------------------------------
echo    - token.txt: yeni fine-grained PAT, tek satir; bu repoyu "Only select" ile secin.
echo    - Klasik PAT: "repo"; ince taneli: Contents + Metadata ^(+ Releases gerekirse^).
echo    - Ya da:  gh auth login
echo    Manuel ZIP: %ZIP_FILE%
goto GIT_RELEASE_DONE

:GH_AUTH_READY
gh release view "v%VER%" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
  gh release create "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" --repo "%REPO%" --title "v%VER%" --notes "v%VER% guncellemesi"
) else (
  gh release upload "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" --repo "%REPO%" --clobber
)
if errorlevel 1 (
  echo    UYARI: ZIP release yuklenemedi ^(yetki veya ag^).
) else (
  echo    OK: ZIP + manifest GitHub'a yuklendi.
)

:GIT_RELEASE_DONE

:: ────────────────────────────────────────────────────
:: [6/6] Git commit + push (surum dosyalari)
:: ────────────────────────────────────────────────────
echo.
echo [6/6] Git commit (guncelleme.json + package.json)...
git add guncelleme.json guncelleme-%VER%.json package.json package-lock.json public/index.html 2>nul
git commit -m "v%VER% release" 2>nul
if errorlevel 1 (
  echo    BILGI: Commit olusmadi ^(zaten commitli veya baska neden^); push yine denenir.
)
git tag -a "v%VER%" -m "komur surum v%VER%" 2>nul
if errorlevel 1 (
  echo    BILGI: Tag zaten var olabilir; devam ediliyor.
)
set "GIT_PUSH_ERR=0"
echo    git push origin main ...
git push origin main
if errorlevel 1 set "GIT_PUSH_ERR=1"
echo    git push origin tag v%VER% ...
git push origin "v%VER%"
if errorlevel 1 (
  git ls-remote origin "refs/tags/v%VER%" 2>nul | findstr /r "." >nul
  if not errorlevel 1 (
    echo    BILGI: Tag v%VER% uzakta zaten vardi ^(release yeniden calistirildiysa normaldir^).
  ) else (
    set "GIT_PUSH_ERR=1"
  )
)
if "!GIT_PUSH_ERR!"=="1" (
  echo    UYARI: Git push basarisiz. Internet, yetki veya once kaydet-ve-githuba-gonder ile main gonderin.
  echo    Release ZIP zaten GitHub'da; kod push elle tamamlanabilir.
) else (
  echo    OK: Git push + tag tamamlandi.
)

echo.
echo ============================================
echo   BASARILI: v%VER% yayinlandi (Electron yok)
echo ============================================
echo.
echo   ZIP:            %ZIP_FILE%
echo   GitHub Release: https://github.com/%REPO%/releases/tag/v%VER%
echo.
endlocal
