# create_venv.ps1 - install the backend dependencies fully offline from the
# bundled wheelhouse, directly into the embeddable Python's site-packages
# (no virtualenv - the embeddable interpreter is already private to this app).
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $PythonExe)) { throw "Python not set up (expected $PythonExe). Run install_python.ps1 first." }
if (-not (Test-Path $WheelDir))  { throw "Wheelhouse not found at $WheelDir." }

$req = Join-Path $BackendDir 'requirements.txt'
Write-Log "Installing backend dependencies from wheelhouse (offline) ..."
$code = Invoke-Logged -FilePath $PythonExe -LogFile (Join-Path $LogDir 'pip.log') -ArgumentList @(
    '-m','pip','install','--no-index','--find-links',$WheelDir,'--no-warn-script-location','-r',$req)
if ($code -ne 0) { throw "Offline pip install failed ($code). See $LogDir\pip.log." }

Write-Log "Backend dependencies installed."
