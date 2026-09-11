# Phase 5 - Architecture lock static guards
# Run: powershell -File scripts/architecture-lock-check.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$failures = @()

function Fail($message) {
  $script:failures += $message
}

function Get-RelativePath($path) {
  return $path.Replace($root + [IO.Path]::DirectorySeparatorChar, '').Replace('\', '/')
}

Write-Host 'Architecture lock check (Phase 5)...' -ForegroundColor Cyan

# 1. supabase.from only in stateRemote.js
$supabaseFromHits = @()
Get-ChildItem -Path 'src' -Recurse -Filter '*.js' | ForEach-Object {
  $rel = Get-RelativePath $_.FullName
  $lines = Get-Content $_.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'supabase\s*\.\s*from\s*\(') {
      $supabaseFromHits += "${rel}:$($i + 1)"
    }
  }
}
$allowedFrom = @('src/lib/stateRemote.js')
foreach ($hit in $supabaseFromHits) {
  $file = $hit.Split(':')[0]
  if ($allowedFrom -notcontains $file) {
    Fail "supabase.from outside allowlist: $hit (allowed: $($allowedFrom -join ', '))"
  }
}

# 2. No static supabase client import in UI modules
$uiModules = Get-ChildItem -Path 'src/modules' -Filter '*.js'
foreach ($file in $uiModules) {
  $rel = Get-RelativePath $file.FullName
  $content = Get-Content $file.FullName -Raw
  if ($content -match "from\s+['\`"][^'\`"]*supabase") {
    Fail "Static supabase import in module: $rel"
  }
}

# 3. Legacy paths must stay removed
$legacyPatterns = @(
  'persistAccountToSupabase',
  'executeLegacyMutation',
  'runLegacyFallback',
  'runFallback\s*:',
  'createAccountLegacy'
)
Get-ChildItem -Path 'src' -Recurse -Filter '*.js' | ForEach-Object {
  $rel = Get-RelativePath $_.FullName
  $content = Get-Content $_.FullName -Raw
  foreach ($pattern in $legacyPatterns) {
    if ($content -match $pattern) {
      Fail "Legacy pattern '$pattern' found in $rel"
    }
  }
}

# 4. Strict UI modules — no direct shared-state mutation
$strictModules = @(
  'src/modules/categories.js',
  'src/modules/obligations.js',
  'src/modules/debts.js',
  'src/modules/history.js'
)
$mutationPattern = 'state\.(accounts|categories|obligations|savings|debts)\.(push|filter)|state\.exchangeRate\s*=(?!=)'
foreach ($rel in $strictModules) {
  $path = Join-Path $root $rel
  if (-not (Test-Path $path)) { continue }
  $lines = Get-Content $path
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $mutationPattern) {
      Fail "Direct state mutation in strict UI module ${rel}:$($i + 1): $($lines[$i].Trim())"
    }
  }
}

# 5. accounts.js — exchangeRate assignment only for render bootstrap default
$accountsPath = Join-Path $root 'src/modules/accounts.js'
if (Test-Path $accountsPath) {
  $lines = Get-Content $accountsPath
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'state\.exchangeRate\s*=(?!=)' -and $lines[$i] -notmatch 'DEFAULT_EXCHANGE_RATE') {
      Fail "Forbidden exchangeRate assignment in accounts.js:$($i + 1)"
    }
  }
}

# 6. actionRegistry must implement all ACTION_TYPES
$registryPath = Join-Path $root 'src/modules/actionRegistry.js'
if (Test-Path $registryPath) {
  $registry = Get-Content $registryPath -Raw
  if ($registry -notmatch 'IMPLEMENTED_TYPES') {
    Fail 'actionRegistry.js missing IMPLEMENTED_TYPES'
  }
  if ($registry -match 'notImplementedResult|Phase 2 pending') {
    Fail 'actionRegistry.js still contains Phase 2 pending handlers'
  }
}

if ($failures.Count -eq 0) {
  Write-Host 'PASS - all architecture lock checks passed.' -ForegroundColor Green
  exit 0
}

Write-Host "FAIL - $($failures.Count) violation(s):" -ForegroundColor Red
foreach ($item in $failures) {
  Write-Host ('  - ' + $item) -ForegroundColor Red
}
exit 1
