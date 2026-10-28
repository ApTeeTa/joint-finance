# Deploy Family Mode Edge Functions only (no DB migrations, no secrets in repo).
# Prerequisites: Supabase CLI installed, `supabase login`, project linked or pass -ProjectRef.
param(
  [string]$ProjectRef = 'zbbhhlxdduhkvyhiesba'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Error 'Supabase CLI not found. Install via Scoop or: npm install supabase --save-dev; npx supabase ...'
}

Write-Host "Project ref: $ProjectRef" -ForegroundColor Cyan
Write-Host 'Deploying family-session and family-snapshot (includes supabase/functions/_shared/cors.ts)...' -ForegroundColor Cyan

supabase functions deploy family-session --project-ref $ProjectRef
supabase functions deploy family-snapshot --project-ref $ProjectRef

Write-Host 'Done. DB was not modified. Secrets remain in Supabase Dashboard only.' -ForegroundColor Green
