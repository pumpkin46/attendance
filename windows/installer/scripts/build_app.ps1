param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" }

$backend = Join-Path $InstallRoot "backend"
$frontend = Join-Path $InstallRoot "frontend"
$ai = Join-Path $InstallRoot "ai-service"

Write-Step "Backend: composer install"
if (Test-Path (Join-Path $backend "composer.json")) {
  Push-Location $backend
  try {
    if (Test-Path ".\vendor") {
      Write-Host "vendor/ exists, skipping composer install"
    } else {
      & composer install --no-interaction --prefer-dist
    }
  } finally { Pop-Location }
}

Write-Step "Frontend: npm ci + build"
if (Test-Path (Join-Path $frontend "package.json")) {
  Push-Location $frontend
  try {
    if (Test-Path ".\node_modules") {
      Write-Host "node_modules/ exists, skipping npm ci"
    } else {
      & npm ci
    }
    & npm run build
  } finally { Pop-Location }
}

Write-Step "AI service: create venv + pip install"
if (Test-Path (Join-Path $ai "requirements.txt")) {
  Push-Location $ai
  try {
    if (-not (Test-Path ".\.venv")) {
      & python -m venv .venv
    }
    & .\.venv\Scripts\python.exe -m pip install --upgrade pip
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  } finally { Pop-Location }
}

