param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$path) {
  if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
}

function Write-Step($msg) { Write-Host "==> $msg" }

<#
  This script is intentionally conservative:
  - It does NOT hardcode vendor installer URLs here yet.
  - It creates the directories and placeholders expected by the rest of the bootstrap.

  In production, you would implement one of:
  A) Bundle offline installers in the Inno Setup payload (recommended for "bundle" requirement)
  B) Download installers at install time (smaller setup, needs internet)
#>

$runtimeDir = Join-Path $InstallRoot "windows\runtime"
Ensure-Dir $runtimeDir

Write-Step "Prereqs placeholder prepared at $runtimeDir"
Write-Step "NOTE: PostgreSQL and Redis are optional (not required)."
Write-Step "TODO: bundle/install PHP, Python, Composer, Node (build-time) as needed"

