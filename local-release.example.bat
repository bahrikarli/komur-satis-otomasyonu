@echo off
title Komur release - yerel token ^(bu ornek dosya GITE GIDER; token YAZMAYIN^)
cd /d "%~dp0"

:: 1) Bu dosyayi KOPYALAYIP adini TAM OLARAK su yapin:  local-release.bat
::    YANLIS: local-release.bat.bat ^(cift uzanti — git PAT yakalar^)
:: 2) Asagidaki PAT_BURAYA... satirina tokeninizi TEK SATIR yazin
:: 3) local-release.bat calistirin ^(release-all.bat i cagirir^)
::
:: UYARI: local-release.bat .gitignore da - asla git e eklemeYIN.
::        Token i release-all.bat icine yazmayin; yanlislikla push riski yuksek.

set "GH_TOKEN=PAT_BURAYA_TEK_SATIR_YAPISTIRIN"
call "%~dp0release-all.bat" %*
