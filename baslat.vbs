Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 1. Klasör yolunu sabitle
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' 2. TEMİZLİK OPERASYONU: 
' Arkada çalışan eski bir Node.exe varsa SESSİZCE (0 parametresiyle) hepsini kapatır.
' True parametresi sayesinde, eskiler tamamen kapanmadan yeni dükkan açılmaz.
WshShell.Run "taskkill /f /im node.exe", 0, True

' 3. YENİ SUNUCUYU GİZLİ BAŞLAT
' /c ile komut penceresi açılır, node başlar ve pencere anında gizlenir (0).
WshShell.Run "cmd.exe /c node index.js", 0, False

' 4. BEKLEME SÜRESİ
' Veritabanı bağlantısı için 3 saniye mola
WScript.Sleep 3000

' 5. DÜKKANI AÇ (Port 3007)
WshShell.Run "chrome.exe --app=http://localhost:3007", 1, False