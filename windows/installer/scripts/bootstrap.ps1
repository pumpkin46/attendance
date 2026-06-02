param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg"
}

Write-Step "Bootstrap start"
Write-Host "InstallRoot: $InstallRoot"

$scripts = Join-Path $InstallRoot "windows\scripts"

Write-Step "Install runtimes and services"
& (Join-Path $scripts "install_prereqs.ps1") -InstallRoot $InstallRoot

Write-Step "Install backend/frontend/ai-service dependencies and build UI"
& (Join-Path $scripts "build_app.ps1") -InstallRoot $InstallRoot

Write-Step "Generate .env files and initialize database"
& (Join-Path $scripts "configure_and_migrate.ps1") -InstallRoot $InstallRoot

Write-Step "Optional AI model prewarm"
& (Join-Path $scripts "prewarm_models.ps1") -InstallRoot $InstallRoot

Write-Step "Bootstrap done"

