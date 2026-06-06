# install_python.ps1 - silently install the bundled CPython into <AppDir>\python.
# Offline: uses the installer baked into the package (no download).
. "$PSScriptRoot\common.ps1"

$target = Join-Path $AppDir 'python'

if (Test-Path $PythonExe) {
    Write-Log "Python already present at $PythonExe - skipping."
    return
}

$installer = Get-ChildItem -Path (Join-Path $AppDir 'pyinstaller') -Filter 'python-*-amd64.exe' -ErrorAction SilentlyContinue |
             Select-Object -First 1
if (-not $installer) {
    throw "Bundled Python installer not found under $AppDir\pyinstaller."
}

Write-Log "Installing Python from $($installer.Name) into $target ..."
# Per-app install (no PATH pollution, no launcher, pip included).
$args = @(
    '/quiet',
    "TargetDir=$target",
    'InstallAllUsers=0',
    'Include_launcher=0',
    'Include_test=0',
    'Include_doc=0',
    'Include_pip=1',
    'AssociateFiles=0',
    'Shortcuts=0',
    'PrependPath=0'
)
$p = Start-Process -FilePath $installer.FullName -ArgumentList $args -Wait -PassThru
if ($p.ExitCode -ne 0) {
    throw "Python installer exited with code $($p.ExitCode)."
}
if (-not (Test-Path $PythonExe)) {
    throw "Python install completed but $PythonExe is missing."
}
Write-Log "Python installed."
