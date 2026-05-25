param(
    [string]$HedefKlasor = '',
    [string]$KisayolAdi = 'Komur Otomasyonu'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($HedefKlasor)) {
    $HedefKlasor = Split-Path -Parent $PSScriptRoot
}
$HedefKlasor = (Resolve-Path -LiteralPath $HedefKlasor).Path

$acilis = Join-Path $HedefKlasor 'ACILIS.bat'
if (-not (Test-Path -LiteralPath $acilis)) {
    Write-Host "HATA: ACILIS.bat bulunamadi: $acilis"
    exit 1
}

$masaustu = [Environment]::GetFolderPath('Desktop')
if (-not $masaustu) { $masaustu = Join-Path $env:USERPROFILE 'Desktop' }
$lnk = Join-Path $masaustu ($KisayolAdi + '.lnk')

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $acilis
$sc.WorkingDirectory = $HedefKlasor
$sc.WindowStyle = 7
$sc.Description = 'Karaarslan Komur Satis Otomasyonu'
$sc.Save()

Write-Host "OK: Masaustu kisayolu -> $lnk"
