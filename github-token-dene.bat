@echo off
title GitHub token tanisi
cd /d "%~dp0"
echo token.txt tanisi ^(token ekrana yazilmaz^)...
echo.
node "%~dp0scripts\token-file-diagnostics.js" "bahrikarli/komur-satis-otomasyonu"
echo.
if errorlevel 1 (
  echo Yukaridaki SONUC satirini okuyun. Duzeltince release-all.bat calistirin.
) else (
  echo Tamam: simdi release-all.bat veya local-release.bat calistirabilirsiniz.
)
pause
