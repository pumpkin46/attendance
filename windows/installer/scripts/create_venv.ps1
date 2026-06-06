# create_venv.ps1 - create the backend virtualenv and install deps fully offline
# from the bundled wheelhouse (no PyPI access).
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $PythonExe)) { throw "Python not installed (expected $PythonExe). Run install_python.ps1 first." }
if (-not (Test-Path $WheelDir))  { throw "Wheelhouse not found at $WheelDir." }

if (-not (Test-Path $VenvPython)) {
    Write-Log "Creating virtualenv at $VenvDir ..."
    & $PythonExe -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "venv creation failed ($LASTEXITCODE)." }
} else {
    Write-Log "Virtualenv already exists - reusing."
}

$req = Join-Path $BackendDir 'requirements.txt'
Write-Log "Upgrading pip (offline) ..."
& $VenvPython -m pip install --no-index --find-links $WheelDir --upgrade pip 2>&1 | Tee-Object -FilePath (Join-Path $LogDir 'pip.log') -Append | Out-Null

Write-Log "Installing backend dependencies from wheelhouse ..."
& $VenvPython -m pip install --no-index --find-links $WheelDir -r $req 2>&1 |
    Tee-Object -FilePath (Join-Path $LogDir 'pip.log') -Append
if ($LASTEXITCODE -ne 0) { throw "Offline pip install failed ($LASTEXITCODE). See $LogDir\pip.log." }

Write-Log "Backend dependencies installed."
