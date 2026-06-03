param(
  [string]$InputZip = "",
  [string]$Version = "18.4",
  [string]$OutputZip = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "==> $msg" }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$pgPrereqDir = Join-Path $repoRoot "windows\installer\prereqs\postgresql"
if (-not $OutputZip) {
  $OutputZip = Join-Path $pgPrereqDir "postgresql-server-windows-x64.zip"
}

if (-not $InputZip) {
  $InputZip = Join-Path $pgPrereqDir "postgresql-$Version-1-windows-x64-binaries.zip"
}

$downloadUrl = "https://get.enterprisedb.com/postgresql/postgresql-$Version-1-windows-x64-binaries.zip"

if (-not (Test-Path $InputZip)) {
  Write-Step "Download EDB binaries ($Version)"
  New-Item -ItemType Directory -Path $pgPrereqDir -Force | Out-Null
  Invoke-WebRequest -Uri $downloadUrl -OutFile $InputZip
}

Write-Step "Extract server-only tree (bin, lib, share; no pgAdmin/doc/symbols)"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("attendance-pg-prepare-" + [Guid]::NewGuid().ToString("N"))
$staging = Join-Path $tmp "server"
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
  Expand-Archive -Path $InputZip -DestinationPath $tmp -Force
  $pgsqlRoot = Join-Path $tmp "pgsql"
  if (-not (Test-Path (Join-Path $pgsqlRoot "bin\initdb.exe"))) {
    throw "Unexpected EDB zip layout; expected pgsql\bin\initdb.exe"
  }

  foreach ($dir in @("bin", "lib", "share")) {
    Copy-Item -Path (Join-Path $pgsqlRoot $dir) -Destination (Join-Path $staging $dir) -Recurse -Force
  }

  if (Test-Path $OutputZip) { Remove-Item $OutputZip -Force }
  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $OutputZip -CompressionLevel Optimal -Force

  $outMb = [math]::Round((Get-Item $OutputZip).Length / 1MB, 1)
  $inMb = [math]::Round((Get-Item $InputZip).Length / 1MB, 1)
  Write-Host ""
  Write-Host "Created: $OutputZip (${outMb} MB)"
  Write-Host "Source:  $InputZip (${inMb} MB full EDB binaries)"
  Write-Host "Bundle postgresql-server-windows-x64.zip in attendance.iss (replaces ~350 MB installer)."
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
