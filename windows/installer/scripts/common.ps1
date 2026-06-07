# common.ps1 - shared paths, ports, and logging for install/uninstall scripts.
# Dot-source this from the other scripts:  . "$PSScriptRoot\common.ps1"
#
# Layout assumption: this file lives in <AppDir>\scripts\ on the target machine
# (Inno Setup installs windows\installer\scripts\* there).

$ErrorActionPreference = 'Stop'

# -- Paths --------------------------------------------------------------------
$AppDir      = Split-Path $PSScriptRoot -Parent              # <AppDir>
$BackendDir  = Join-Path $AppDir 'backend'
# Bundled embeddable Python; dependencies are installed directly into its
# Lib\site-packages (no virtualenv).
$PyHome      = Join-Path $AppDir 'python'
$PythonExe   = Join-Path $PyHome 'python.exe'
$WheelDir    = Join-Path $AppDir 'wheelhouse'
$PgBin       = Join-Path $AppDir 'pgsql\bin'
$RedisDir    = Join-Path $AppDir 'redis'
$NginxDir    = Join-Path $AppDir 'nginx'
$FrontendDir = Join-Path $AppDir 'frontend\dist'
$ModelsHome  = Join-Path $AppDir 'models\insightface'        # INSIGHTFACE_HOME

$DataRoot    = Join-Path $env:ProgramData 'AttendancePlatform'
$PgData      = Join-Path $DataRoot 'pgdata'
$LogDir      = Join-Path $DataRoot 'logs'
$AppDataDir  = Join-Path $DataRoot 'appdata'                 # runtime writable data
$StateFile   = Join-Path $DataRoot 'install-state.json'      # generated creds, ports

# -- Service / DB / ports -----------------------------------------------------
$PgServiceName    = 'AttendancePostgres'
$RedisServiceName = 'Memurai'           # service name created by the Memurai MSI
$DbName           = 'attendance'
$DbUser           = 'postgres'
# Non-default internal ports so the bundled services don't collide with things
# the machine already runs on common defaults (Postgres 5432, uvicorn 8000).
# uvicorn is internal (nginx proxies to it); the browser only uses $NginxPort.
$PgPort           = 15432
$RedisPort        = 6379          # Memurai default; bound cleanly on the target
$ApiPort          = 18000         # uvicorn (loopback only, behind nginx)
$NginxPort        = 8080          # the web UI the user opens

# -- Logging ------------------------------------------------------------------
function Initialize-Logging {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    Initialize-Logging
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line  = "[$stamp] [$Level] $Message"
    Write-Host $line
    Add-Content -Path (Join-Path $LogDir 'install.log') -Value $line -Encoding utf8
}

# Run a native executable, append ALL its output (stdout + stderr) to a log, and
# return its real exit code. The script-wide 'Stop' preference would otherwise
# turn any line a tool writes to stderr (e.g. pip's "not on PATH" warning, or a
# "new pip available" notice) into a terminating error even on success - so we
# relax it for the duration of the call and judge success by the exit code only.
function Invoke-Logged {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$LogFile
    )
    Initialize-Logging
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # Tee writes stdout+stderr to the log; Out-Null keeps the tool's output
        # from leaking into this function's return value (only the exit code).
        & $FilePath @ArgumentList 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Save-State {
    param([hashtable]$State)
    if (-not (Test-Path $DataRoot)) { New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null }
    $State | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
}

function Get-State {
    if (Test-Path $StateFile) { return (Get-Content $StateFile -Raw | ConvertFrom-Json) }
    return $null
}
