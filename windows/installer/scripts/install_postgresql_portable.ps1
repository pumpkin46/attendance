param(
  [Parameter(Mandatory = $true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PgServiceName = "AttendancePostgreSQL"
$PgSuperuser = "postgres"
$PgSuperPassword = "postgres"

function Write-Step([string]$msg) { Write-Host "==> $msg" }

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

function Get-PostgreSqlPrereqZip([string]$prereqsDir) {
  $pgDir = Join-Path $prereqsDir "postgresql"
  $serverZip = Get-ChildItem -Path $pgDir -Filter "postgresql-server-windows-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($serverZip) { return $serverZip }

  $binariesZip = Get-ChildItem -Path $pgDir -Filter "postgresql-*-windows-x64-binaries.zip" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($binariesZip) { return $binariesZip }

  return $null
}

function Expand-PostgreSqlServerTree([string]$zipPath, [string]$destinationDir) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("attendance-pg-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force

    $serverRoot = $null
    if (Test-Path (Join-Path $tmp "bin\initdb.exe")) {
      $serverRoot = $tmp
    } elseif (Test-Path (Join-Path $tmp "pgsql\bin\initdb.exe")) {
      $serverRoot = Join-Path $tmp "pgsql"
    } else {
      throw "PostgreSQL zip does not contain bin\initdb.exe (expected server-only or EDB binaries layout)."
    }

    foreach ($dir in @("bin", "lib", "share")) {
      $src = Join-Path $serverRoot $dir
      if (-not (Test-Path $src)) {
        throw "Missing server folder '$dir' in PostgreSQL archive."
      }
      $dest = Join-Path $destinationDir $dir
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      Copy-Item -Path $src -Destination $dest -Recurse -Force
    }
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Initialize-PostgreSqlCluster([string]$pgBinDir, [string]$dataDir) {
  $initdb = Join-Path $pgBinDir "initdb.exe"
  $pwFile = Join-Path ([System.IO.Path]::GetTempPath()) ("attendance-pg-pw-" + [Guid]::NewGuid().ToString("N"))
  try {
    Set-Content -Path $pwFile -Value $PgSuperPassword -NoNewline
    & $initdb -D $dataDir -U $PgSuperuser -E UTF8 --locale=C --pwfile=$pwFile --no-instructions
    if ($LASTEXITCODE -ne 0) {
      throw "initdb failed with exit code $LASTEXITCODE"
    }
  } finally {
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  }

  $confPath = Join-Path $dataDir "postgresql.conf"
  if (Test-Path $confPath) {
    $conf = Get-Content $confPath -Raw
    if ($conf -notmatch "(?m)^listen_addresses\s*=") {
      Add-Content -Path $confPath -Value "`nlisten_addresses = 'localhost'`n"
    }
  }
}

function Register-PostgreSqlService([string]$pgBinDir, [string]$dataDir, [string]$serviceName) {
  $pgCtl = Join-Path $pgBinDir "pg_ctl.exe"
  $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Status -eq "Running") {
      & $pgCtl stop -D $dataDir -m fast -w | Out-Null
    }
    & $pgCtl unregister -N $serviceName | Out-Null
  }
  & $pgCtl register -N $serviceName -U "LocalSystem" -D $dataDir
  if ($LASTEXITCODE -ne 0) {
    throw "pg_ctl register failed with exit code $LASTEXITCODE"
  }
  & sc.exe config $serviceName start= delayed-auto | Out-Null
  Start-Service -Name $serviceName
}

$runtimeDir = Join-Path $InstallRoot "windows\runtime"
$prereqsDir = Join-Path $InstallRoot "windows\prereqs"
$pgRuntime = Join-Path $runtimeDir "postgresql"
$pgBinDir = Join-Path $pgRuntime "bin"
$pgDataDir = Join-Path $pgRuntime "data"

if (Test-TcpPort "127.0.0.1" 5432) {
  Write-Host "PostgreSQL already reachable on 127.0.0.1:5432 (skipping)"
  return
}

$pgZip = Get-PostgreSqlPrereqZip $prereqsDir
if (-not $pgZip) {
  throw @"
Missing PostgreSQL prereq zip in: $(Join-Path $prereqsDir 'postgresql')
Place postgresql-server-windows-x64.zip (server-only, ~42 MB), or run:
  powershell -NoProfile -ExecutionPolicy Bypass -File windows/installer/scripts/prepare_postgresql_prereq.ps1
"@
}

Write-Step "Install portable PostgreSQL server from $($pgZip.Name)"
New-Item -ItemType Directory -Path $pgRuntime -Force | Out-Null
Expand-PostgreSqlServerTree -zipPath $pgZip.FullName -destinationDir $pgRuntime

if (-not (Test-Path (Join-Path $pgBinDir "postgres.exe"))) {
  throw "postgres.exe not found after extracting server files to $pgRuntime"
}

if (-not (Test-Path $pgDataDir)) {
  Write-Step "Initialize PostgreSQL data cluster"
  Initialize-PostgreSqlCluster -pgBinDir $pgBinDir -dataDir $pgDataDir
} else {
  Write-Host "PostgreSQL data directory already exists (skipping initdb)"
}

Write-Step "Register Windows service '$PgServiceName'"
Register-PostgreSqlService -pgBinDir $pgBinDir -dataDir $pgDataDir -serviceName $PgServiceName

if (-not (Test-TcpPort "127.0.0.1" 5432)) {
  throw "PostgreSQL service started but port 5432 is not reachable."
}

Write-Host "Portable PostgreSQL server running at $pgRuntime (superuser: $PgSuperuser)"
