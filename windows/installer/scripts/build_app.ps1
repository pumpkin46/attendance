param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" }

$frontend = Join-Path $InstallRoot "frontend"
$backend = Join-Path $InstallRoot "backend"

$bundledPythonExe = Join-Path $InstallRoot "windows\runtime\python\python.exe"
$pythonExe = if (Test-Path $bundledPythonExe) { $bundledPythonExe } else { "python" }

Write-Step "Frontend: verify dist/ exists"
if (-not (Test-Path (Join-Path $frontend "dist"))) {
  throw "frontend/dist is missing. For offline installs, build the UI at packaging time (npm run build) and bundle frontend/dist into the installer."
}

Write-Step "Backend (Python): create venv + pip install"
if (Test-Path (Join-Path $backend "requirements.txt")) {
  Push-Location $backend
  try {
    if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
      & $pythonExe -m venv .venv
    }
    & .\.venv\Scripts\python.exe -m pip install --upgrade pip
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  } finally { Pop-Location }
}
