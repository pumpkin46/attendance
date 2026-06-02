param(
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" }

$ai = Join-Path $InstallRoot "ai-service"

if (-not (Test-Path $ai)) {
  Write-Host "ai-service not found, skipping model prewarm"
  exit 0
}

Push-Location $ai
try {
  if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "ai-service venv not found, skipping model prewarm"
    exit 0
  }

  Write-Step "Download anti-spoof ONNX model (if missing)"
  & .\.venv\Scripts\python.exe scripts\download_antispoof_model.py

  # Optional: warm InsightFace weights.
  # InsightFace's FaceAnalysis(name="buffalo_l") downloads model assets on first use.
  # We'll trigger a tiny import + initialization so first app run is faster.
  Write-Step "Warm InsightFace weights (best-effort)"
  $code = @"
from app.services.face_service import _get_face_app
app = _get_face_app()
print('insightface_ready', app is not None)
"@
  & .\.venv\Scripts\python.exe -c $code
} catch {
  Write-Host "Model prewarm failed (non-fatal): $($_.Exception.Message)"
} finally { Pop-Location }

