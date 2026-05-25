param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = 'Stop'
$appUrl = $Url.Trim()
if (-not $appUrl.EndsWith('/')) { $appUrl += '/' }

function Test-UzakSunucu {
    param([string]$Base)
    try {
        $surum = ($Base.TrimEnd('/')) + '/api/surum'
        $null = Invoke-WebRequest -Uri $surum -UseBasicParsing -TimeoutSec 8
        return $true
    } catch {
        return $false
    }
}

function Start-AppPencere {
    param([string]$Target)
    $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path -LiteralPath $edge)) {
        $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    }
    if (Test-Path -LiteralPath $edge) {
        Start-Process -FilePath $edge -ArgumentList @('--app=' + $Target, '--new-window')
        return 'edge'
    }

    $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    if (-not (Test-Path -LiteralPath $chrome)) {
        $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    }
    if (Test-Path -LiteralPath $chrome) {
        Start-Process -FilePath $chrome -ArgumentList @('--app=' + $Target, '--new-window')
        return 'chrome'
    }

    Start-Process $Target
    return 'browser'
}

Write-Host ''
Write-Host '=========================================='
Write-Host '  KOMUR - UZAK SUNUCU (MASAUSTU)'
Write-Host '=========================================='
Write-Host "Adres: $appUrl"
Write-Host ''

if (Test-UzakSunucu -Base $appUrl) {
    Write-Host '[OK] Sunucu yanit veriyor.'
} else {
    Write-Host '[UYARI] Sunucuya ulasilamadi veya /api/surum yanit vermedi.'
    Write-Host '        IP, port, guvenlik duvari ve uzak PC''deki baslat.bat kontrol edin.'
    $devam = Read-Host 'Yine de acilsin mi? (E/H)'
    if ($devam -notmatch '^[Ee]') { exit 1 }
}

$tarayici = Start-AppPencere -Target $appUrl
Write-Host "[OK] Uygulama penceresi acildi ($tarayici)."
Write-Host ''
