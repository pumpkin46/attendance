# install_python.ps1 - set up the bundled embeddable CPython under <AppDir>\python.
# The embeddable distribution is just extracted (no MSI), so it never conflicts
# with a Python already installed on the machine. We then enable pip offline via
# the bundled get-pip.py and point the path config at the backend + site-packages.
. "$PSScriptRoot\common.ps1"

$pyHome   = Join-Path $AppDir 'python'
$embedDir = Join-Path $AppDir 'pyembed'

if (Test-Path $PythonExe) {
    Write-Log "Python already present at $PythonExe - skipping."
    return
}

$zip = Get-ChildItem -Path $embedDir -Filter 'python-*-embed-amd64.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $zip) { throw "Bundled Python embeddable zip not found under $embedDir." }

Write-Log "Extracting embeddable Python from $($zip.Name) -> $pyHome ..."
New-Item -ItemType Directory -Force -Path $pyHome | Out-Null
Expand-Archive -Path $zip.FullName -DestinationPath $pyHome -Force
if (-not (Test-Path $PythonExe)) { throw "Embeddable Python extraction failed (no python.exe)." }

# Configure the path file: enable site (so pip + installed packages import), and
# add Lib\site-packages and the backend dir so `import main` / `import app` work
# from any working directory (the embeddable runtime does NOT add the CWD).
$pth = Get-ChildItem -Path $pyHome -Filter '*._pth' | Select-Object -First 1
if (-not $pth) { throw "Embeddable ._pth file not found in $pyHome." }
$zipLine = (Get-Content $pth.FullName | Where-Object { $_ -match '\.zip\s*$' } | Select-Object -First 1)
if (-not $zipLine) { $zipLine = 'python314.zip' }
@(
    $zipLine.Trim()
    '.'
    'Lib\site-packages'
    $BackendDir
    ''
    'import site'
) | Set-Content -Path $pth.FullName -Encoding ascii
New-Item -ItemType Directory -Force -Path (Join-Path $pyHome 'Lib\site-packages') | Out-Null

# Bootstrap pip from the offline wheelhouse (get-pip needs the pip wheel locally).
$getpip = Join-Path $embedDir 'get-pip.py'
if (-not (Test-Path $getpip)) { throw "get-pip.py not found in $embedDir." }
Write-Log "Bootstrapping pip (offline) ..."
$code = Invoke-Logged -FilePath $PythonExe -LogFile (Join-Path $LogDir 'pip.log') -ArgumentList @(
    $getpip,'--no-index','--find-links',$WheelDir,'--no-warn-script-location')
if ($code -ne 0) { throw "pip bootstrap failed ($code). See $LogDir\pip.log." }
$code = Invoke-Logged -FilePath $PythonExe -LogFile (Join-Path $LogDir 'pip.log') -ArgumentList @('-m','pip','--version')
if ($code -ne 0) { throw "pip not importable after bootstrap." }

Write-Log "Embeddable Python ready with pip."
