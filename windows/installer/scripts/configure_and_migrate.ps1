param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" }

$backendDir = Join-Path $InstallRoot "backend"

$bundledPythonExe = Join-Path $InstallRoot "windows\runtime\python\python.exe"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$pythonExe = if (Test-Path $venvPython) { $venvPython } elseif (Test-Path $bundledPythonExe) { $bundledPythonExe } else { "python" }

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

function Set-OrReplaceEnvLine([string]$text, [string]$key, [string]$value) {
  if ($text -match "(?m)^$([regex]::Escape($key))=") {
    return [regex]::Replace($text, "(?m)^$([regex]::Escape($key))=.*$", "$key=$value")
  }
  if (-not $text.EndsWith("`n")) { $text += "`n" }
  return $text + "$key=$value`n"
}

Write-Step "Ensure backend .env"
Push-Location $backendDir
try {
  if (-not (Test-Path ".\.env")) {
    if (Test-Path ".\.env.example") {
      Copy-Item ".\.env.example" ".\.env"
    } else {
      Set-Content ".\.env" ""
    }
  }

  $envText = Get-Content ".\.env" -Raw
  if (-not $envText) { $envText = "" }

  # PostgreSQL required: fail fast if not reachable.
  $pgReachable = Test-TcpPort "127.0.0.1" 5432
  if (-not $pgReachable) {
    throw "PostgreSQL is required but was not detected on 127.0.0.1:5432. Install it (or select it in the installer UI) and re-run setup."
  }
  Write-Step "PostgreSQL detected on 127.0.0.1:5432"
  $envText = Set-OrReplaceEnvLine $envText "DATABASE_URL" "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/attendance"

  # Redis required: fail fast if not reachable.
  $redisReachable = Test-TcpPort "127.0.0.1" 6379
  if (-not $redisReachable) {
    throw "Redis is required but was not detected on 127.0.0.1:6379. Install it (or select it in the installer UI) and re-run setup."
  }
  Write-Step "Redis detected on 127.0.0.1:6379"
  $envText = Set-OrReplaceEnvLine $envText "REDIS_URL" "redis://127.0.0.1:6379/0"

  # Generate a random JWT secret if missing
  if ($envText -notmatch "(?m)^JWT_SECRET=\S+") {
    $jwtSecret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
    $envText = Set-OrReplaceEnvLine $envText "JWT_SECRET" $jwtSecret
    Write-Step "Generated JWT_SECRET"
  }

  $envText = Set-OrReplaceEnvLine $envText "APP_NAME" "Attendance Platform"
  $envText = Set-OrReplaceEnvLine $envText "APP_ENV" "production"

  Set-Content ".\.env" $envText -NoNewline

  Write-Step "Create database if it doesn't exist"
  try {
    $pgBin = $null
    $pgBinCandidates = @(
      (Join-Path $InstallRoot "windows\runtime\postgresql\bin"),
      "C:\Program Files\PostgreSQL\17\bin",
      "C:\Program Files\PostgreSQL\16\bin",
      "C:\Program Files\PostgreSQL\15\bin",
      "C:\Program Files\PostgreSQL\14\bin"
    )
    foreach ($candidate in $pgBinCandidates) {
      if (Test-Path (Join-Path $candidate "psql.exe")) {
        $pgBin = $candidate
        break
      }
    }
    if ($pgBin) {
      $env:PGPASSWORD = "postgres"
      & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -tc "SELECT 1 FROM pg_database WHERE datname='attendance'" | Out-Null
      $dbExists = $LASTEXITCODE -eq 0
      if (-not $dbExists) {
        & "$pgBin\createdb.exe" -U postgres -h 127.0.0.1 attendance
        Write-Step "Created database 'attendance'"
      } else {
        Write-Step "Database 'attendance' already exists"
      }
    } else {
      Write-Host "WARNING: psql not found, cannot auto-create database. Ensure 'attendance' database exists."
    }
  } catch {
    Write-Host "WARNING: Could not auto-create database: $_"
  }

  Write-Step "Run database migrations (Alembic)"
  & $pythonExe -m alembic upgrade head

  Write-Step "Seed database"
  & $pythonExe seed.py

} finally { Pop-Location }
