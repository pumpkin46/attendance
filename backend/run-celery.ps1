<#
.SYNOPSIS
  Launch the Celery worker and/or beat scheduler for background jobs.

.DESCRIPTION
  Periodic jobs (visitor expiry, anomaly detection, retention/snapshot purge)
  run via Celery when CELERY_ENABLED=true. They need BOTH a worker (executes
  tasks) and beat (schedules them), plus a reachable Redis broker (REDIS_URL).

  On Windows the default prefork pool is unsupported, so the worker uses
  --pool=solo (single-process), matching the packaged tray launcher.

  With no switch, this starts the worker in a new window and beat in the
  foreground; pressing Ctrl+C stops beat and then the worker. Use -Worker or
  -Beat to run just one in the foreground.

.EXAMPLE
  .\run-celery.ps1            # worker (new window) + beat (foreground)

.EXAMPLE
  .\run-celery.ps1 -Worker    # only the worker, in this window

.EXAMPLE
  .\run-celery.ps1 -Beat      # only the scheduler, in this window
#>
param(
  [switch]$Worker,
  [switch]$Beat,
  [string]$LogLevel = "info"
)

$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }  # fall back to PATH

$app = "app.celery_app.celery_app"
# Keep beat's schedule DB out of the app's data/ dir so a -Dev API reload (which
# watches the project) isn't tripped by beat's periodic writes.
$schedule = Join-Path $PSScriptRoot "data\celerybeat-schedule"

$workerArgs = @("-m", "celery", "-A", $app, "worker", "--loglevel=$LogLevel", "--pool=solo")
$beatArgs   = @("-m", "celery", "-A", $app, "beat",   "--loglevel=$LogLevel", "--schedule", $schedule)

if ($Worker -and -not $Beat) {
  Write-Host "Starting Celery worker (--pool=solo)…" -ForegroundColor Cyan
  & $python @workerArgs
  return
}

if ($Beat -and -not $Worker) {
  Write-Host "Starting Celery beat…" -ForegroundColor Cyan
  & $python @beatArgs
  return
}

# Default: worker in a separate window, beat in the foreground.
Write-Host "Starting Celery worker (new window) + beat (this window)…" -ForegroundColor Cyan
$workerProc = Start-Process -FilePath $python -ArgumentList $workerArgs -WorkingDirectory $PSScriptRoot -PassThru
try {
  & $python @beatArgs
}
finally {
  if ($workerProc -and -not $workerProc.HasExited) {
    Write-Host "Stopping Celery worker…" -ForegroundColor Yellow
    Stop-Process -Id $workerProc.Id -Force -ErrorAction SilentlyContinue
  }
}
