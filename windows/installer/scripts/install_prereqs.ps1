param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [switch]$InstallPostgres,
  [switch]$InstallRedis
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$path) {
  if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
}

function Write-Step($msg) { Write-Host "==> $msg" }

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 800) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($iar) | Out-Null
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Run-Installer([string]$exePath, [string]$args) {
  if (-not (Test-Path $exePath)) {
    throw "Missing installer: $exePath"
  }
  Write-Host "Running: $exePath $args"
  $p = Start-Process -FilePath $exePath -ArgumentList $args -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "Installer failed (exit $($p.ExitCode)): $exePath"
  }
}

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

$prereqsDir = Join-Path $InstallRoot "windows\prereqs"
Ensure-Dir $prereqsDir

Write-Step "Optional: install PostgreSQL"
if ($InstallPostgres) {
  if (Test-TcpPort "127.0.0.1" 5432) {
    Write-Host "PostgreSQL already reachable on 127.0.0.1:5432 (skipping install)"
  } else {
    # Place an offline installer at:
    #   windows\installer\prereqs\postgresql\postgresql-installer.exe
    # and ensure Inno Setup copies it to {app}\windows\prereqs\postgresql\
    $pgExe = Join-Path $prereqsDir "postgresql\postgresql-installer.exe"
    Run-Installer $pgExe "--mode unattended"
  }
} else {
  Write-Host "User did not select PostgreSQL install."
}

Write-Step "Optional: install Redis"
if ($InstallRedis) {
  if (Test-TcpPort "127.0.0.1" 6379) {
    Write-Host "Redis already reachable on 127.0.0.1:6379 (skipping install)"
  } else {
    # Place an offline installer at:
    #   windows\installer\prereqs\redis\redis-installer.exe
    $redisExe = Join-Path $prereqsDir "redis\redis-installer.exe"
    Run-Installer $redisExe "/S"
  }
} else {
  Write-Host "User did not select Redis install."
}

Write-Step "TODO: bundle/install PHP, Python, Composer, Node (build-time) as needed"

