<#
.SYNOPSIS
  Download + normalize the offline prerequisites baked into the installer.
  Run ONCE on an online build machine. Idempotent: skips anything already present.

  Produces, under windows\installer\prereqs\ :
    python\python-<ver>-amd64.exe
    postgresql\{bin,lib,share,...}              (EDB "binaries only" zip, flattened)
    nginx\{nginx.exe,conf,html,...}             (nginx/Windows zip, flattened)
    models\insightface\models\buffalo_l\*       (InsightFace recognition pack)
    models\MiniFASNetV2.onnx                    (anti-spoof model)

  The Python wheelhouse is built separately by build-installer.ps1 (it needs
  backend\requirements.txt and a matching interpreter).
#>
[CmdletBinding()]
param(
    [string]$PythonVersion   = '3.14.4',
    [string]$PostgresUrl     = 'https://get.enterprisedb.com/postgresql/postgresql-18.2-1-windows-x64-binaries.zip',
    [string]$NginxVersion    = '1.30.2',
    [string]$BuffaloUrl      = 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip',
    [string]$AntispoofUrl    = 'https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx',
    # Memurai = Redis-compatible native Windows server, installed as a service via
    # its MSI. NOTE: Memurai *Developer* Edition (the free default below) is for
    # development/testing only; production requires Memurai Enterprise. To bundle
    # an Enterprise MSI instead, drop it in installer\prereqs\redis\ or pass its
    # URL here.
    [string]$MemuraiMsiUrl   = 'https://dist.memurai.com/releases/Memurai-Developer/4.3.2/Memurai-Developer-v4.3.2.msi'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # faster Invoke-WebRequest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PrereqDir = Join-Path $PSScriptRoot 'prereqs'
$tmp       = Join-Path $env:TEMP 'attendance-prereqs'
# Start from a clean temp so a changed component version never reuses a stale
# download (the temp zip names are version-agnostic).
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Download($url, $dest) {
    if (Test-Path $dest) { Write-Host "  exists: $dest"; return }
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

function Flatten-SingleRoot($dir) {
    # If $dir wraps everything in one subfolder (e.g. pgsql\ or nginx-<ver>\),
    # hoist that folder's contents up. Ignore the tracked .gitkeep placeholder
    # so it doesn't count as a second root item.
    $items = Get-ChildItem -Force $dir | Where-Object { $_.Name -ne '.gitkeep' }
    if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
        $inner = $items[0].FullName
        Get-ChildItem -Force $inner | Move-Item -Destination $dir -Force
        Remove-Item $inner -Recurse -Force
    }
}

# -- Python installer ---------------------------------------------------------
Write-Host "[1/5] Python $PythonVersion installer"
$pyDir = Join-Path $PrereqDir 'python'
New-Item -ItemType Directory -Force -Path $pyDir | Out-Null
Download "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" `
         (Join-Path $pyDir "python-$PythonVersion-amd64.exe")

# -- PostgreSQL (binaries-only zip) -------------------------------------------
Write-Host "[2/6] PostgreSQL binaries"
$pgDir = Join-Path $PrereqDir 'postgresql'
if (-not (Test-Path (Join-Path $pgDir 'bin\postgres.exe'))) {
    $zip = Join-Path $tmp 'postgresql.zip'
    Download $PostgresUrl $zip
    Get-ChildItem -Force $pgDir | Where-Object { $_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force
    Expand-Archive -Path $zip -DestinationPath $pgDir -Force
    Flatten-SingleRoot $pgDir   # zip contains a top-level pgsql\ folder
    if (-not (Test-Path (Join-Path $pgDir 'bin\postgres.exe'))) { throw "PostgreSQL extraction failed." }
} else { Write-Host "  exists: $pgDir" }
# Trim to the server runtime only (idempotent): drop the bundled pgAdmin GUI
# (~690 MB!), StackBuilder, docs, headers and symbols. We only run the server.
# Use `rd /s /q` first - it copes with pgAdmin's very deep (>260 char) paths
# that make Remove-Item throw "directory not empty".
foreach ($d in @('pgAdmin 4','StackBuilder','doc','include','symbols')) {
    $p = Join-Path $pgDir $d
    if (Test-Path -LiteralPath $p) {
        cmd /c rd /s /q "$p" 2>$null
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Host "  pruned postgresql\$d"
    }
}

# -- nginx --------------------------------------------------------------------
Write-Host "[3/6] nginx $NginxVersion"
$ngDir = Join-Path $PrereqDir 'nginx'
if (-not (Test-Path (Join-Path $ngDir 'nginx.exe'))) {
    $zip = Join-Path $tmp 'nginx.zip'
    Download "https://nginx.org/download/nginx-$NginxVersion.zip" $zip
    Get-ChildItem -Force $ngDir | Where-Object { $_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force
    Expand-Archive -Path $zip -DestinationPath $ngDir -Force
    Flatten-SingleRoot $ngDir   # zip contains nginx-<ver>\ folder
    if (-not (Test-Path (Join-Path $ngDir 'nginx.exe'))) { throw "nginx extraction failed." }
} else { Write-Host "  exists: $ngDir" }

# -- InsightFace buffalo_l ----------------------------------------------------
Write-Host "[4/6] InsightFace buffalo_l model"
$bufDest = Join-Path $PrereqDir 'models\insightface\models\buffalo_l'
if (-not (Test-Path (Join-Path $bufDest '*.onnx'))) {
    $zip = Join-Path $tmp 'buffalo_l.zip'
    Download $BuffaloUrl $zip
    New-Item -ItemType Directory -Force -Path $bufDest | Out-Null
    Expand-Archive -Path $zip -DestinationPath $bufDest -Force
    Flatten-SingleRoot $bufDest  # some releases nest buffalo_l\ inside the zip
    if (-not (Get-ChildItem $bufDest -Filter '*.onnx' -ErrorAction SilentlyContinue)) {
        throw "buffalo_l extraction produced no .onnx files."
    }
} else { Write-Host "  exists: $bufDest" }
# Keep only detection (det_10g) + recognition (w600k_r50). The pipeline uses
# face.embedding/bbox/kps only - never 2D/3D landmarks or gender-age - so drop
# those models (idempotent): saves ~143 MB with no functional impact.
foreach ($m in @('1k3d68.onnx','2d106det.onnx','genderage.onnx')) {
    $p = Join-Path $bufDest $m
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Force; Write-Host "  pruned model $m" }
}

# -- Anti-spoof ONNX ----------------------------------------------------------
Write-Host "[5/6] Anti-spoof MiniFASNetV2.onnx"
$modelsDir = Join-Path $PrereqDir 'models'
New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
Download $AntispoofUrl (Join-Path $modelsDir 'MiniFASNetV2.onnx')

# -- Memurai (Redis-compatible Windows server, MSI) ---------------------------
Write-Host "[6/6] Memurai (Redis for Windows)"
$rdDir = Join-Path $PrereqDir 'redis'
New-Item -ItemType Directory -Force -Path $rdDir | Out-Null
$haveMsi = Get-ChildItem -Path $rdDir -Filter '*.msi' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $haveMsi) {
    # Drop any leftover non-MSI payload (e.g. a previous native-Redis bundle).
    Get-ChildItem -Force $rdDir | Where-Object { $_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force
    $msiName = Split-Path $MemuraiMsiUrl -Leaf
    Download $MemuraiMsiUrl (Join-Path $rdDir $msiName)
    if (-not (Get-ChildItem -Path $rdDir -Filter '*.msi' -ErrorAction SilentlyContinue)) {
        throw "Memurai MSI download failed."
    }
} else { Write-Host "  exists: $($haveMsi.Name)" }

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`nPrerequisites ready under $PrereqDir"
