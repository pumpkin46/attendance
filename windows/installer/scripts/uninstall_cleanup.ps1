param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host "`n==> $msg" }

# =====================================================================
# 1. Stop application processes
# =====================================================================
Write-Step "Stop nginx"
try {
  Get-Process -Name "nginx" -ErrorAction SilentlyContinue | Stop-Process -Force
} catch {}

Write-Step "Stop AI service (uvicorn / python)"
try {
  $runtimePython = Join-Path $InstallRoot "windows\runtime\python\python.exe"
  $venvPython    = Join-Path $InstallRoot "backend\.venv\Scripts\python.exe"
  Get-Process -Name "python", "python3", "uvicorn" -ErrorAction SilentlyContinue |
    Where-Object {
      $p = $_.Path
      $p -and ($p -like "$InstallRoot*" -or $p -eq $runtimePython -or $p -eq $venvPython)
    } | Stop-Process -Force
} catch {}

Write-Step "Stop Attendance Launcher"
try {
  Get-Process -Name "AttendanceLauncher" -ErrorAction SilentlyContinue | Stop-Process -Force
} catch {}

Start-Sleep -Seconds 2

# =====================================================================
# 2. Uninstall PostgreSQL
# =====================================================================
Write-Step "Uninstall PostgreSQL"
try {
  $pgUninstaller = $null
  foreach ($ver in @("17", "16", "15", "14")) {
    $candidate = "C:\Program Files\PostgreSQL\$ver\uninstall-postgresql.exe"
    if (Test-Path $candidate) { $pgUninstaller = $candidate; break }
  }
  if ($pgUninstaller) {
    Write-Host "Found PostgreSQL uninstaller: $pgUninstaller"
    $p = Start-Process -FilePath $pgUninstaller -ArgumentList @("--mode", "unattended") -Wait -PassThru
    Write-Host "PostgreSQL uninstaller exited with code $($p.ExitCode)"
  } else {
    Write-Host "PostgreSQL uninstaller not found (may not have been installed by us)"
  }

  Stop-Service -Name "postgresql*" -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2

  foreach ($ver in @("17", "16", "15", "14")) {
    $pgDir = "C:\Program Files\PostgreSQL\$ver"
    if (Test-Path $pgDir) {
      Remove-Item $pgDir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "Removed $pgDir"
    }
  }
  $pgParent = "C:\Program Files\PostgreSQL"
  if ((Test-Path $pgParent) -and (Get-ChildItem $pgParent -ErrorAction SilentlyContinue).Count -eq 0) {
    Remove-Item $pgParent -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path "C:\PostgreSQL\data") {
    Remove-Item "C:\PostgreSQL\data" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed PostgreSQL data directory"
  }
  if ((Test-Path "C:\PostgreSQL") -and (Get-ChildItem "C:\PostgreSQL" -ErrorAction SilentlyContinue).Count -eq 0) {
    Remove-Item "C:\PostgreSQL" -Force -ErrorAction SilentlyContinue
  }
} catch {
  Write-Host "WARNING: PostgreSQL uninstall had errors: $_"
}

# =====================================================================
# 3. Uninstall Memurai (Redis)
# =====================================================================
Write-Step "Uninstall Memurai (Redis)"
try {
  Stop-Service -Name "Memurai" -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $memuraiPkg = Get-Package -Name "*Memurai*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($memuraiPkg) {
    Write-Host "Found Memurai package: $($memuraiPkg.Name)"
    $memuraiPkg | Uninstall-Package -Force -ErrorAction SilentlyContinue
    Write-Host "Memurai uninstalled via package manager"
  } else {
    $memuraiUninstall = Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like "*Memurai*" } | Select-Object -First 1
    if ($memuraiUninstall -and $memuraiUninstall.UninstallString) {
      Write-Host "Found Memurai in registry, running uninstall"
      $uninstCmd = $memuraiUninstall.UninstallString
      if ($uninstCmd -match "msiexec") {
        $productCode = if ($uninstCmd -match '\{[A-F0-9\-]+\}') { $Matches[0] } else { $null }
        if ($productCode) {
          Start-Process "msiexec.exe" -ArgumentList @("/x", $productCode, "/quiet", "/norestart") -Wait
        }
      } else {
        Start-Process "cmd.exe" -ArgumentList @("/c", $uninstCmd, "/quiet") -Wait
      }
      Write-Host "Memurai uninstalled via registry entry"
    } else {
      Write-Host "Memurai not found (may not have been installed by us)"
    }
  }

  $memuraiDir = "C:\Program Files\Memurai"
  if (Test-Path $memuraiDir) {
    Remove-Item $memuraiDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $memuraiDir"
  }
} catch {
  Write-Host "WARNING: Memurai uninstall had errors: $_"
}

# =====================================================================
# 4. Uninstall Python (bundled runtime install)
# =====================================================================
Write-Step "Uninstall Python (bundled runtime)"
try {
  $pyRuntimeDir = Join-Path $InstallRoot "windows\runtime\python"

  $pyPkg = Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
                            "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "Python 3.*" -and $_.InstallLocation -like "$pyRuntimeDir*" } |
    Select-Object -First 1

  if ($pyPkg -and $pyPkg.UninstallString) {
    Write-Host "Found registered Python install ($($pyPkg.DisplayName)), running uninstaller"
    $p = Start-Process -FilePath $pyPkg.UninstallString -ArgumentList @("/uninstall", "/quiet") -Wait -PassThru
    Write-Host "Python uninstaller exited with code $($p.ExitCode)"
  } elseif (Test-Path $pyRuntimeDir) {
    Write-Host "No registered Python uninstaller found, removing runtime directory directly"
    Remove-Item $pyRuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $pyRuntimeDir"
  } else {
    Write-Host "Bundled Python runtime not found (may not have been installed by us)"
  }
} catch {
  Write-Host "WARNING: Python uninstall had errors: $_"
}

# =====================================================================
# 5. Remove hosts file entry
# =====================================================================
Write-Step "Remove attendance.local from hosts file"
try {
  $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
  if (Test-Path $hostsPath) {
    $lines = Get-Content $hostsPath
    $filtered = $lines | Where-Object {
      $_ -notmatch "attendance\.local" -and $_ -notmatch "# Attendance Platform"
    }
    Set-Content $hostsPath $filtered -Force
    Write-Host "Cleaned hosts file"
  }
} catch {
  Write-Host "WARNING: Could not clean hosts file: $_"
}

# =====================================================================
# 6. Remove remaining app data and logs
# =====================================================================
Write-Step "Remove application data"
try {
  $dirsToClean = @(
    (Join-Path $InstallRoot "backend\.venv"),
    (Join-Path $InstallRoot "backend\data"),
    (Join-Path $InstallRoot "backend\models"),
    (Join-Path $InstallRoot "windows\runtime"),
    (Join-Path $InstallRoot "logs")
  )
  foreach ($d in $dirsToClean) {
    if (Test-Path $d) {
      Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "Removed $d"
    }
  }
} catch {
  Write-Host "WARNING: Could not remove some app data: $_"
}

# =====================================================================
# 7. Remove the entire install directory (Inno leaves runtime-created files)
# =====================================================================
Write-Step "Remove install directory"
try {
  if (Test-Path $InstallRoot) {
    Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $InstallRoot"
  }
} catch {
  Write-Host "WARNING: Could not fully remove install directory (some files may be in use): $_"
}

Write-Step "Uninstall cleanup complete"
