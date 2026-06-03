param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [switch]$InstallPostgres,
  [switch]$InstallRedis,
  [switch]$InstallPython
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

function Run-Installer([string]$exePath, [string[]]$installerArgs) {
  if (-not (Test-Path $exePath)) {
    $resolved = Get-Command $exePath -ErrorAction SilentlyContinue
    if (-not $resolved) {
      throw "Missing installer: $exePath"
    }
  }
  Write-Output "Running: $exePath $($installerArgs -join ' ')"
  $p = Start-Process -FilePath $exePath -ArgumentList $installerArgs -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "Installer failed (exit $($p.ExitCode)): $exePath"
  }
}

$runtimeDir = Join-Path $InstallRoot "windows\runtime"
Ensure-Dir $runtimeDir

$prereqsDir = Join-Path $InstallRoot "windows\prereqs"
Ensure-Dir $prereqsDir

# --- Python ---
Write-Step "Install Python 3.14"
if ($InstallPython) {
  $pythonRuntime = Join-Path $runtimeDir "python\python.exe"
  if (Test-Path $pythonRuntime) {
    Write-Host "Python runtime already exists at $pythonRuntime (skipping)"
  } else {
    $pyInstaller = Get-ChildItem -Path (Join-Path $prereqsDir "python") -Filter "python-*-amd64.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pyInstaller) {
      throw "Missing bundled Python installer in: $(Join-Path $prereqsDir 'python')"
    }
    $pyTargetDir = Join-Path $runtimeDir "python"
    # InstallAllUsers=1 avoids per-user install issues under Program Files (we are already running elevated).
    Run-Installer $pyInstaller.FullName @(
      "/quiet",
      "InstallAllUsers=1",
      ("TargetDir=`"{0}`"" -f $pyTargetDir),
      "Include_pip=1",
      "PrependPath=0",
      "Shortcuts=0",
      "SimpleInstall=1"
    )
    if (-not (Test-Path (Join-Path $pyTargetDir "python.exe"))) {
      throw "Python install completed but python.exe not found at: $pyTargetDir"
    }
    Write-Host "Python installed to $pyTargetDir"
  }
} else {
  Write-Host "User did not select Python install (skipped)."
}

# --- PostgreSQL ---
Write-Step "Install PostgreSQL (server + psql only)"
if ($InstallPostgres) {
  if (Test-TcpPort "127.0.0.1" 5432) {
    Write-Host "PostgreSQL already reachable on 127.0.0.1:5432 (skipping)"
  } else {
    $pgExe = Join-Path $prereqsDir "postgresql\postgresql-installer.exe"
    if (-not (Test-Path $pgExe)) {
      throw "Missing PostgreSQL installer at: $pgExe"
    }
    $pgDataDir = "C:\PostgreSQL\data"
    Run-Installer $pgExe @(
      "--mode", "unattended",
      "--unattendedmodeui", "none",
      "--superpassword", "postgres",
      "--enable-components", "server,commandlinetools",
      "--disable-components", "pgAdmin,stackbuilder"
    )
    Write-Host "PostgreSQL installed (server + psql)"
  }
} else {
  Write-Host "User did not select PostgreSQL install (skipped)."
}

# --- Redis / Memurai ---
Write-Step "Install Redis (Memurai)"
if ($InstallRedis) {
  if (Test-TcpPort "127.0.0.1" 6379) {
    Write-Host "Redis already reachable on 127.0.0.1:6379 (skipping)"
  } else {
    $memuraiMsi = Join-Path $prereqsDir "redis\memurai.msi"
    if (-not (Test-Path $memuraiMsi)) {
      throw "Missing Memurai MSI at: $memuraiMsi"
    }
    Run-Installer "msiexec.exe" @("/i", "`"$memuraiMsi`"", "/quiet", "/norestart")
    Write-Host "Memurai (Redis) installed"
  }
} else {
  Write-Host "User did not select Redis install (skipped)."
}

# --- Nginx ---
Write-Step "Extract nginx for UI serving"
$nginxRuntime = Join-Path $runtimeDir "nginx\nginx.exe"
if (Test-Path $nginxRuntime) {
  Write-Host "nginx already exists at $nginxRuntime (skipping)"
} else {
  $nginxZip = Get-ChildItem -Path (Join-Path $prereqsDir "nginx") -Filter "nginx-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $nginxZip) {
    throw "Missing nginx zip in: $(Join-Path $prereqsDir 'nginx')"
  }
  $nginxTmp = Join-Path $runtimeDir "nginx-tmp"
  Ensure-Dir $nginxTmp
  Expand-Archive -Path $nginxZip.FullName -DestinationPath $nginxTmp -Force
  $extracted = Get-ChildItem -Path $nginxTmp -Directory | Select-Object -First 1
  if (-not $extracted -or -not (Test-Path (Join-Path $extracted.FullName "nginx.exe"))) {
    throw "nginx.exe not found after extracting $($nginxZip.Name)"
  }
  $nginxDir = Join-Path $runtimeDir "nginx"
  if (Test-Path $nginxDir) { Remove-Item $nginxDir -Recurse -Force }
  Move-Item $extracted.FullName $nginxDir
  Remove-Item $nginxTmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "nginx extracted to $nginxDir"
}

Write-Step "Generate nginx.conf"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "generate_nginx_conf.ps1") -InstallRoot $InstallRoot

Write-Step "Register attendance.local in hosts file"
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$marker = "attendance.local"
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -and $hostsContent -match [regex]::Escape($marker)) {
  Write-Host "hosts file already contains $marker (skipping)"
} else {
  $entry = "`r`n# Attendance Platform (offline local domain)`r`n127.0.0.1  attendance.local`r`n"
  [System.IO.File]::AppendAllText($hostsPath, $entry)
  Write-Host "Added 127.0.0.1 attendance.local to $hostsPath"
}

Write-Step "Prereq installation complete"
