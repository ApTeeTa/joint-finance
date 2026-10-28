param(
  [string]$TestPath = 'tests/purchase-planner-qa-test.html',
  [int]$Port = 8766
)

$root = Split-Path -Parent $PSScriptRoot
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  Write-Error 'Chrome not found'
  exit 2
}

$server = Start-Process powershell -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  (Join-Path $PSScriptRoot 'serve-static.ps1'),
  '-Port', $Port
) -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2

$url = "http://127.0.0.1:$Port/$TestPath"
$outFile = Join-Path $env:TEMP "purchase-qa-$(Get-Random).txt"

try {
  & $chrome --headless=new --disable-gpu --virtual-time-budget=8000 `
    --run-all-compositor-stages-before-draw --dump-dom $url 2>$null | Out-File -FilePath $outFile -Encoding utf8

  $html = Get-Content -Raw -LiteralPath $outFile
  if ($html -match 'ALL PASSED') {
    Write-Output 'RESULT: PASS'
    if ($html -match '<pre id="out">([\s\S]*?)</pre>') {
      ($Matches[1] -replace '<[^>]+>', '' -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>' ) -split "`n" | Where-Object { $_ -match '^(OK|FAIL):' } | ForEach-Object { Write-Output $_.Trim() }
    }
    exit 0
  }

  Write-Output 'RESULT: FAIL'
  if ($html -match '<pre id="out">([\s\S]*?)</pre>') {
    ($Matches[1] -replace '<[^>]+>', '' ) -split "`n" | Where-Object { $_ -match '^(OK|FAIL):' } | ForEach-Object { Write-Output $_.Trim() }
  } else {
    Write-Output 'Could not parse test output'
    Write-Output $html.Substring(0, [Math]::Min(500, $html.Length))
  }
  exit 1
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $outFile -ErrorAction SilentlyContinue
}
