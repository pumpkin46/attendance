<#
.SYNOPSIS
  Launch the backend API (uvicorn).

.DESCRIPTION
  Stable by default — no file watching, so the server never drops mid-request.
  Use this for the kiosk, demos, and any long run.

  -Dev enables auto-reload for editing backend code, but excludes the runtime
  data dir so the app's own writes (FAISS index at data/faiss.index, etc.) don't
  restart the server. Plain `--reload` watches everything, so every enrollment
  reload-drops the port and the frontend logs "ECONNREFUSED 127.0.0.1:8000".

.EXAMPLE
  .\run.ps1            # stable (recommended for kiosk / long runs)

.EXAMPLE
  .\run.ps1 -Dev       # auto-reload backend code, ignore data/ writes
#>
param(
  [switch]$Dev,
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }  # fall back to PATH

$uvicornArgs = @("-m", "uvicorn", "main:app", "--host", $BindHost, "--port", "$Port")
if ($Dev) {
  $uvicornArgs += @("--reload", "--reload-exclude", "data/*", "--reload-exclude", "*.index", "--reload-exclude", "*.json")
  Write-Host "Starting backend (dev, auto-reload; data/ excluded) on ${BindHost}:${Port}" -ForegroundColor Cyan
} else {
  Write-Host "Starting backend (stable, no reload) on ${BindHost}:${Port}" -ForegroundColor Cyan
}

& $python @uvicornArgs
