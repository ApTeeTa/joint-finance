# Run browser-based QA suites headlessly (no production data touched).
param(
  [int]$Port = 8778
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  Write-Error 'Google Chrome not found at default path — open tests/*.html manually in browser.'
}

$tests = @(
  'tests/pre-beta-comprehensive-test.html',
  'tests/purchase-simulation-test.html',
  'tests/finance-validation-test.html',
  'tests/finance-core-hardening-test.html',
  'tests/family-mode-module-test.html',
  'tests/pre-beta-family-flow-simulation.html'
)

$server = Start-Process powershell -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  (Join-Path $PSScriptRoot 'serve-static.ps1'),
  '-Port', $Port
) -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2

$totalPass = 0
$totalFail = 0
$failedSuites = @()

try {
  foreach ($rel in $tests) {
    $url = "http://127.0.0.1:$Port/$rel"
    $outFile = Join-Path $env:TEMP "prebeta-$(Get-Random).html"
    & $chrome --headless=new --disable-gpu --virtual-time-budget=15000 `
      --run-all-compositor-stages-before-draw --dump-dom $url 2>$null | Out-File -FilePath $outFile -Encoding utf8
    $html = Get-Content -Raw -LiteralPath $outFile
    Remove-Item -LiteralPath $outFile -ErrorAction SilentlyContinue

    $suiteOk = $false
    if ($html -match 'ALL PASSED') { $suiteOk = $true }
    if ($html -match '(\d+)/(\d+) passed, 0 failed') { $suiteOk = $true }
    if ($html -match 'SUMMARY: (\d+)/(\d+) passed, 0 failed') { $suiteOk = $true }

    if ($html -match 'SUMMARY: (\d+)/(\d+) passed, (\d+) failed') {
      $p = [int]$Matches[1]; $t = [int]$Matches[2]; $f = [int]$Matches[3]
      Write-Host "$rel => $p/$t passed, $f failed" -ForegroundColor $(if ($f -eq 0) { 'Green' } else { 'Red' })
      $totalPass += $p
      $totalFail += $f
      if ($f -gt 0) { $failedSuites += $rel }
      continue
    }

    if ($suiteOk) {
      Write-Host "$rel => PASS" -ForegroundColor Green
      $totalPass += 1
    } else {
      Write-Host "$rel => FAIL (parse or assertions)" -ForegroundColor Red
      $totalFail += 1
      $failedSuites += $rel
      if ($html -match 'FAIL[^\n<]*') {
        [regex]::Matches($html, 'FAIL[^<\n]{0,120}') | ForEach-Object { Write-Host "  $($_.Value)" }
      }
    }
  }

  Write-Host "`nAggregate: suites=$($tests.Count) suite-failures=$($failedSuites.Count)" -ForegroundColor Cyan
  if ($failedSuites.Count -gt 0) {
    Write-Host "Failed suites: $($failedSuites -join ', ')" -ForegroundColor Red
    exit 1
  }
  exit 0
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
