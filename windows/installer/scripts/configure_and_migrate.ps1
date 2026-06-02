param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" }

$backend = Join-Path $InstallRoot "backend"

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
Push-Location $backend
try {
  if (-not (Test-Path ".\.env")) {
    Copy-Item ".\.env.example" ".\.env"
  }

  $envText = Get-Content ".\.env" -Raw

  # Always point AI service to local instance
  $envText = Set-OrReplaceEnvLine $envText "AI_SERVICE_URL" "http://127.0.0.1:8001"

  # PostgreSQL required: fail fast if not reachable.
  $pgReachable = Test-TcpPort "127.0.0.1" 5432
  if (-not $pgReachable) {
    throw "PostgreSQL is required but was not detected on 127.0.0.1:5432. Install it (or select it in the installer UI) and re-run setup."
  }
  Write-Step "PostgreSQL detected on 127.0.0.1:5432"
  $envText = Set-OrReplaceEnvLine $envText "DB_CONNECTION" "pgsql"

  # Redis required: fail fast if not reachable.
  $redisReachable = Test-TcpPort "127.0.0.1" 6379
  if (-not $redisReachable) {
    throw "Redis is required but was not detected on 127.0.0.1:6379. Install it (or select it in the installer UI) and re-run setup."
  }
  Write-Step "Redis detected on 127.0.0.1:6379 -> enabling redis cache/queue/session"
  $envText = Set-OrReplaceEnvLine $envText "CACHE_STORE" "redis"
  $envText = Set-OrReplaceEnvLine $envText "QUEUE_CONNECTION" "redis"
  $envText = Set-OrReplaceEnvLine $envText "SESSION_DRIVER" "redis"
  $envText = Set-OrReplaceEnvLine $envText "REDIS_HOST" "127.0.0.1"
  $envText = Set-OrReplaceEnvLine $envText "REDIS_PORT" "6379"

  Set-Content ".\.env" $envText -NoNewline

  Write-Step "Generate APP_KEY if missing"
  $envText2 = Get-Content ".\.env" -Raw
  if ($envText2 -match "(?m)^APP_KEY=$" -or $envText2 -notmatch "(?m)^APP_KEY=") {
    & php artisan key:generate
  }

  Write-Step "Run migrations + seed"
  & php artisan migrate --seed --force
} finally { Pop-Location }

