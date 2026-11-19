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
  'tests/pre-beta-family-flow-simulation.html',
  'tests/analytics-read-model-test.html',
  'tests/modal-draft-store-test.html',
  'tests/modal-background-lifecycle-test.html',
  'tests/modal-open-overlay-registry-test.html',
  'tests/modal-session-legacy-sanitize-test.html',
  'tests/modal-draft-input-no-false-prompt-test.html',
  'tests/production-accounts-ui-test.html',
  'tests/saving-spend-amount-validity-test.html',
  'tests/saving-spend-partial-test.html',
  'tests/obligation-payment-reserve-test.html',
  'tests/obligation-stability-fix-test.html',
  'tests/obligation-edit-date-ui-test.html',
  'tests/audit-regression-test.html',
  'tests/app-calendar-test.html',
  'tests/misc-category-display-test.html',
  'tests/category-monthly-limit-expense-test.html',
  'tests/category-limit-confirm-flow-test.html',
  'tests/jf-notify-modal-test.html',
  'tests/modal-cancel-button-layout-test.html',
  'tests/account-transfer-fx-test.html',
  'tests/history-scroll-touch-markup-test.html',
  'tests/history-responsive-layout-test.html',
  'tests/history-compact-mobile-test.html',
  'tests/history-category-expense-filter-test.html',
  'tests/expense-modal-submit-lifecycle-test.html',
  'tests/transaction-operation-date-test.html'
)

$server = Start-Process powershell -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  (Join-Path $PSScriptRoot 'serve-static.ps1'),
  '-Port', $Port
) -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2

function Invoke-HeadlessChromeDomDump {
  param(
    [string]$Url,
    [string]$OutFile,
    [int]$TimeBudgetMs = 15000
  )
  $chromeArgs =
    "--headless=new --disable-gpu --virtual-time-budget=$TimeBudgetMs " +
    '--run-all-compositor-stages-before-draw --dump-dom ' +
    "`"$Url`""
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    cmd /c "`"$chrome`" $chromeArgs 2>nul" > $OutFile
  } finally {
    $ErrorActionPreference = $prevEa
  }
}

$totalPass = 0
$totalFail = 0
$failedSuites = @()

try {
  foreach ($rel in $tests) {
    $url = "http://127.0.0.1:$Port/$rel"
    $outFile = Join-Path $env:TEMP "prebeta-$(Get-Random).html"
    Invoke-HeadlessChromeDomDump -Url $url -OutFile $outFile
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
