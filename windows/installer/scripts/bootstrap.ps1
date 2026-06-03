param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [switch]$InstallPostgres,
  [switch]$InstallRedis,
  [switch]$InstallPython,
  [string]$LogPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg"
}

if (-not $LogPath) {
  $LogPath = Join-Path $InstallRoot "logs\bootstrap.log"
}

try {
  $logDir = Split-Path -Parent $LogPath
  if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
} catch {
  # Best-effort; continue without failing bootstrap just because logging couldn't be initialized.
}

try {
  Start-Transcript -Path $LogPath -Append | Out-Null
} catch {
  Write-Host "WARNING: Could not start transcript logging to $LogPath"
}

Write-Step "Bootstrap start"
Write-Host "InstallRoot: $InstallRoot"
Write-Host "InstallPostgres: $InstallPostgres"
Write-Host "InstallRedis: $InstallRedis"
Write-Host "InstallPython: $InstallPython"
$scripts = Join-Path $InstallRoot "windows\scripts"

Write-Step "Install runtimes and services"
& (Join-Path $scripts "install_prereqs.ps1") -InstallRoot $InstallRoot -InstallPostgres:$InstallPostgres -InstallRedis:$InstallRedis -InstallPython:$InstallPython

Write-Step "Install Python dependencies for merged backend"
& (Join-Path $scripts "build_app.ps1") -InstallRoot $InstallRoot

Write-Step "Generate .env and initialize database"
& (Join-Path $scripts "configure_and_migrate.ps1") -InstallRoot $InstallRoot

Write-Step "Optional AI model prewarm"
& (Join-Path $scripts "prewarm_models.ps1") -InstallRoot $InstallRoot

Write-Step "Bootstrap done"

try {
  Stop-Transcript | Out-Null
} catch {
  # ignore
}

