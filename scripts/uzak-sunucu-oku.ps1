param(
    [string]$Kok = '',
    [int]$VarsayilanPort = 3017
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Kok)) {
    $Kok = Split-Path -Parent $PSScriptRoot
}
$cfg = Join-Path $Kok 'uzak-sunucu.txt'
$port = $VarsayilanPort

$readPort = Join-Path $Kok 'scripts\read-port.js'
if (Test-Path -LiteralPath $readPort) {
    try {
        $p = & node $readPort $Kok 2>$null
        if ($p) { $port = [int]$p }
    } catch { }
}

$hostLine = ''
if (Test-Path -LiteralPath $cfg) {
    $lines = Get-Content -LiteralPath $cfg -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and $_ -notmatch '^\s*#' }
    if ($lines.Count -ge 1) { $hostLine = $lines[0] }
    if ($lines.Count -ge 2 -and $lines[1] -match '^\d+$') {
        $port = [int]$lines[1]
    }
}

if (-not $hostLine) {
    Write-Output ''
    exit 0
}

if ($hostLine -match '^https?://') {
    $u = [Uri]$hostLine
    $base = '{0}://{1}:{2}/' -f $u.Scheme, $u.Host, $u.Port
    Write-Output $base
    exit 0
}

if ($hostLine -match ':') {
    Write-Output ('http://' + $hostLine.Trim().TrimEnd('/') + '/')
    exit 0
}

Write-Output ('http://{0}:{1}/' -f $hostLine, $port)
