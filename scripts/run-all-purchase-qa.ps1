$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 8777

$serverJob = Start-Job -ScriptBlock {
  param($Port, $Root)
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$Port/")
  $listener.Start()
  while ($listener.IsListening) {
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 20
      continue
    }
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.LocalPath.TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index.html' }
      $full = Join-Path $Root ($path -replace '/', [IO.Path]::DirectorySeparatorChar)
      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($full)
        if ($full.EndsWith('.html')) { $context.Response.ContentType = 'text/html; charset=utf-8' }
        elseif ($full.EndsWith('.js')) { $context.Response.ContentType = 'text/javascript; charset=utf-8' }
        else { $context.Response.ContentType = 'application/octet-stream' }
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $context.Response.StatusCode = 404
      }
    } finally {
      $context.Response.Close()
    }
  }
} -ArgumentList $port, $root

Start-Sleep -Seconds 2

try {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$port/tests/purchase-planner-qa-test.html" -UseBasicParsing -TimeoutSec 15
  Write-Output "SERVER OK status=$($probe.StatusCode) bytes=$($probe.Content.Length)"

  $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (-not (Test-Path $chrome)) { throw 'Chrome not found' }

  $tests = @(
    'tests/purchase-simulation-test.html',
    'tests/purchase-planner-qa-test.html',
    'tests/purchase-save-prefill-test.html',
    'tests/purchase-planner-ui-test.html',
    'tests/purchase-save-flow-test.html'
  )

  $allPass = $true
  foreach ($test in $tests) {
    $url = "http://127.0.0.1:$port/$test"
    $outFile = Join-Path $env:TEMP ("qa-" + ($test -replace '[\\/]', '-') + '.html')
    & $chrome --headless=new --disable-gpu --virtual-time-budget=15000 `
      --run-all-compositor-stages-before-draw --dump-dom $url 2>$null | Out-File -FilePath $outFile -Encoding utf8

    $html = Get-Content -Raw -LiteralPath $outFile
    $passed = ($html -match 'ALL PASSED') -or ($html -match 'id="summary pass"')

    Write-Output "--- $test ---"
    if ($passed) { Write-Output 'RESULT: PASS' }
    else {
      $allPass = $false
      Write-Output 'RESULT: FAIL'
    }

    if ($html -match '<pre id="out">([\s\S]*?)</pre>') {
      $text = $Matches[1] -replace '<span class="(?:ok|fail)">', '' -replace '</span>', '' -replace '<[^>]+>', ''
      $text -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^(OK|FAIL):|ALL PASSED|\d+ FAILED' } | ForEach-Object { Write-Output $_ }
    } else {
      Write-Output 'No test output captured.'
      Write-Output ($html.Substring(0, [Math]::Min(400, $html.Length)))
    }

    Remove-Item -LiteralPath $outFile -ErrorAction SilentlyContinue
  }

  if (-not $allPass) { exit 1 }
  exit 0
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 2
} finally {
  if ($serverJob) {
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
  }
}
