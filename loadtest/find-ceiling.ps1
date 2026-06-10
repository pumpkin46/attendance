<#
.SYNOPSIS
  Sweep k6 VUS levels against api-slo.js to find the single-node SLO ceiling.

.DESCRIPTION
  Runs loadtest/k6/api-slo.js once per VUS level. k6 exits non-zero if any
  threshold (p95 SLOs, error rate, checks) is breached, so each level is a
  clean PASS/FAIL. The ceiling is the highest VUS level that still PASSes.

  Seed representative data first (see README): python backend/seed_loadtest.py

.EXAMPLE
  .\find-ceiling.ps1 -Password 'secret'

.EXAMPLE
  .\find-ceiling.ps1 -BaseUrl http://127.0.0.1:8000 -Email admin@attendance.local `
                     -Password 'secret' -Levels 1,2,3,5,8 -Duration 30s
#>
param(
    [string]$BaseUrl = "http://127.0.0.1:8000",
    [string]$Email = "admin@attendance.local",
    [Parameter(Mandatory = $true)][string]$Password,
    [int[]]$Levels = @(1, 2, 3, 5, 8, 12, 20),
    [string]$Duration = "30s"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "k6\api-slo.js"
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    throw "k6 not found on PATH. Install it (winget install k6) - see README."
}

$ceiling = $null
foreach ($vus in $Levels) {
    Write-Host "`n=== VUS=$vus (duration $Duration) ===" -ForegroundColor Cyan
    # --quiet keeps the per-level output short; the exit code is what matters.
    & k6 run --quiet `
        -e BASE_URL=$BaseUrl -e EMAIL=$Email -e PASSWORD=$Password `
        -e VUS=$vus -e DURATION=$Duration $script
    if ($LASTEXITCODE -eq 0) {
        Write-Host "VUS=$vus  PASS" -ForegroundColor Green
        $ceiling = $vus
    }
    else {
        Write-Host "VUS=$vus  FAIL (threshold breached) - stopping sweep" -ForegroundColor Yellow
        break
    }
}

Write-Host ""
if ($null -ne $ceiling) {
    Write-Host "Single-node ceiling: VUS=$ceiling holds all SLOs." -ForegroundColor Green
}
else {
    Write-Host "Even VUS=$($Levels[0]) breached an SLO. Lower the floor or check the server/DB." -ForegroundColor Red
}
