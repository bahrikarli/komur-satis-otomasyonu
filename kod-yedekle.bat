@echo off
title Komur - Kod yedegi (yerel ZIP)
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "YEDEK_KOK=%USERPROFILE%\KOMUR-kod-yedekleri"

echo.
echo ============================================
echo   KOMUR - KAYNAK KOD YEDEGI (ZIP)
echo ============================================
echo.
echo Bu dosya VERITABANI degil, PROJE KODUNU yedekler:
echo   index.js, public\, scripts\, *.bat, package.json ...
echo.
echo Veritabani yedegi icin: program icinde Ayarlar - Yedek Al
echo GitHub yedegi icin:      kaydet-ve-githuba-gonder.bat
echo.

for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set "TS=%%t"
set "ZIP=%YEDEK_KOK%\komur-kod-%TS%.zip"

if not exist "%YEDEK_KOK%" mkdir "%YEDEK_KOK%"

echo Yedek aliniyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%ROOT%'.TrimEnd('\');" ^
  "$zip = '%ZIP%';" ^
  "$tmp = Join-Path $env:TEMP ('komur-yedek-' + [guid]::NewGuid().ToString());" ^
  "New-Item -ItemType Directory -Path $tmp | Out-Null;" ^
  "$exclude = @('node_modules','dist','dist-desktop','release-v*','.git');" ^
  "Get-ChildItem -LiteralPath $root -Force | Where-Object {" ^
  "  $n = $_.Name;" ^
  "  if ($n -eq 'node_modules' -or $n -eq 'dist' -or $n -like 'dist-desktop*' -or $n -like 'release-v*' -or $n -eq '.git') { return $false }" ^
  "  if ($n -like 'komur-satis-otomasyonu-*.zip') { return $false }" ^
  "  if ($n -like '*.exe') { return $false }" ^
  "  return $true" ^
  "} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $tmp $_.Name) -Recurse -Force };" ^
  "if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force };" ^
  "Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip -Force;" ^
  "Remove-Item -LiteralPath $tmp -Recurse -Force;" ^
  "Write-Host ('OK: ' + $zip)"

if errorlevel 1 (
  echo HATA: ZIP olusturulamadi.
  pause
  exit /b 1
)

echo.
echo Tamam. Yedek dosyasi:
echo   %ZIP%
echo.
explorer /select,"%ZIP%"
pause
endlocal
