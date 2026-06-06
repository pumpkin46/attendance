<#
.SYNOPSIS
  Build the offline Windows installer (AttendancePlatformSetup.exe) end-to-end.
  Run on an ONLINE Windows build machine with Python 3.14 (x64), Node 20+ and
  the .NET 9 SDK installed.

.DESCRIPTION
  Steps:
    1. Ensure Inno Setup (iscc) is available - silent-install if missing.
    2. Download + normalize prerequisites (fetch-prereqs.ps1).
    3. Build the offline pip wheelhouse from backend\requirements.txt.
    4. Build the frontend (npm ci && npm run build) -> frontend\dist.
    5. Publish the self-contained .NET tray launcher.
    6. Generate the app icon (.ico) from the PNG.
    7. Compile the Inno Setup script -> AttendancePlatformSetup.exe.

.PARAMETER SkipPrereqs   Skip the prerequisite download (reuse what's there).
.PARAMETER Version       Product/installer version string. Default 2.0.0.
#>
[CmdletBinding()]
param(
    [switch]$SkipPrereqs,
    [string]$Version       = '2.0.0',
    [string]$PythonVersion = '3.14.4',
    # Stable redirect that always serves the current Inno Setup 6 release
    # (files.jrsoftware.org only keeps the latest pinned build online).
    [string]$InnoUrl       = 'https://jrsoftware.org/download.php/is.exe'
)

$ErrorActionPreference = 'Stop'
$RepoRoot   = Split-Path $PSScriptRoot -Parent
$WinDir     = $PSScriptRoot
$Backend    = Join-Path $RepoRoot 'backend'
$Frontend   = Join-Path $RepoRoot 'frontend'
$PrereqDir  = Join-Path $WinDir 'installer\prereqs'
$WheelDir   = Join-Path $PrereqDir 'wheelhouse'
$Launcher   = Join-Path $WinDir 'launcher\AttendanceLauncher'
$LauncherOut= Join-Path $WinDir 'launcher\publish'
$IssPath    = Join-Path $WinDir 'installer\inno\attendance.iss'
$OutputDir  = Join-Path $WinDir 'installer\inno\Output'

function Section($n) { Write-Host "`n========== $n ==========" -ForegroundColor Cyan }
function Require-Cmd($name) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $c) { throw "Required tool '$name' not found on PATH." }
    return $c.Source
}

# -- 1. Inno Setup ------------------------------------------------------------
Section '1. Inno Setup'
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    foreach ($p in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $p) { $iscc = $p; break }
    }
}
if (-not $iscc) {
    Write-Host "Inno Setup not found - downloading + installing silently ..."
    $exe = Join-Path $env:TEMP "innosetup.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $InnoUrl -OutFile $exe -UseBasicParsing
    Start-Process -FilePath $exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait
    $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $iscc)) { throw "Inno Setup install failed." }
}
Write-Host "iscc: $iscc"

$python = Require-Cmd 'python'
$npm    = Require-Cmd 'npm'
$dotnet = Require-Cmd 'dotnet'

# Sanity-check the interpreter matches the target (cp wheels must match).
$pyTag = & $python -c "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$wantTag = ($PythonVersion -split '\.')[0..1] -join '.'
if ($pyTag -ne $wantTag) {
    throw "Build Python is $pyTag but installer targets $wantTag. The wheelhouse must be built with a $wantTag x64 interpreter."
}

# -- 2. Prerequisites ---------------------------------------------------------
Section '2. Prerequisites'
if ($SkipPrereqs) {
    Write-Host "Skipping prerequisite download (-SkipPrereqs)."
} else {
    & (Join-Path $WinDir 'installer\fetch-prereqs.ps1') -PythonVersion $PythonVersion
}

# -- 3. Wheelhouse (offline pip) ----------------------------------------------
Section '3. Wheelhouse'
New-Item -ItemType Directory -Force -Path $WheelDir | Out-Null
Write-Host "Building wheelhouse from requirements.txt (this downloads/builds all wheels) ..."
# pip wheel resolves the full tree to wheels - building any sdists (e.g. insightface)
# locally so the target needs only --no-index installs.
& $python -m pip wheel -r (Join-Path $Backend 'requirements.txt') -w $WheelDir
if ($LASTEXITCODE -ne 0) { throw "pip wheel failed - cannot assemble offline wheelhouse." }
$whlCount = (Get-ChildItem $WheelDir -Filter '*.whl').Count
Write-Host "Wheelhouse contains $whlCount wheels."

# -- 4. Frontend --------------------------------------------------------------
Section '4. Frontend build'
Push-Location $Frontend
try {
    # Force the relative /api/v1 base (same-origin via nginx). An explicit process
    # env var also overrides any stray frontend\.env a developer may have left.
    $env:VITE_API_URL = '/api/v1'
    if (Test-Path (Join-Path $Frontend 'package-lock.json')) { & $npm ci } else { & $npm install }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed." }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $Frontend 'dist\index.html'))) { throw "frontend\dist\index.html missing after build." }

# -- 5. Icon (before launcher so it can be embedded) --------------------------
Section '5. Icon'
$png = Join-Path $WinDir 'assets\app-icon.png'
$ico = Join-Path $WinDir 'assets\app.ico'
if ((Test-Path $png) -and -not (Test-Path $ico)) {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($png)
    try {
        $bmp = New-Object System.Drawing.Bitmap($src, 256, 256)
        $h = $bmp.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($h)
        $fs = [System.IO.File]::Create($ico)
        $icon.Save($fs); $fs.Close()
        $bmp.Dispose()
    } finally { $src.Dispose() }
    Write-Host "Generated $ico"
} elseif (Test-Path $ico) { Write-Host "Icon already present." }
else { Write-Host "No app-icon.png - installer will use the default Inno icon." }

# -- 6. Tray launcher ---------------------------------------------------------
Section '6. Tray launcher'
if (Test-Path $LauncherOut) { Remove-Item $LauncherOut -Recurse -Force }
& $dotnet publish (Join-Path $Launcher 'AttendanceLauncher.csproj') `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $LauncherOut
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }
if (-not (Test-Path (Join-Path $LauncherOut 'AttendanceLauncher.exe'))) { throw "AttendanceLauncher.exe not produced." }

# -- 7. Compile installer -----------------------------------------------------
Section '7. Compile installer'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
& $iscc "/DMyAppVersion=$Version" "/DPythonVersion=$PythonVersion" $IssPath
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }

$setup = Get-ChildItem $OutputDir -Filter 'AttendancePlatformSetup*.exe' | Select-Object -First 1
if ($setup) {
    $finalPath = Join-Path $RepoRoot $setup.Name
    Copy-Item $setup.FullName $finalPath -Force
    Write-Host "`nDONE -> $finalPath" -ForegroundColor Green
} else {
    throw "Installer EXE not found in $OutputDir."
}
