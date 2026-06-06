# common.ps1 - shared paths, ports, and logging for install/uninstall scripts.
# Dot-source this from the other scripts:  . "$PSScriptRoot\common.ps1"
#
# Layout assumption: this file lives in <AppDir>\scripts\ on the target machine
# (Inno Setup installs windows\installer\scripts\* there).

$ErrorActionPreference = 'Stop'

# -- Paths --------------------------------------------------------------------
$AppDir      = Split-Path $PSScriptRoot -Parent              # <AppDir>
$BackendDir  = Join-Path $AppDir 'backend'
$VenvDir     = Join-Path $BackendDir '.venv'
$VenvPython  = Join-Path $VenvDir 'Scripts\python.exe'
$VenvScripts = Join-Path $VenvDir 'Scripts'
$PythonExe   = Join-Path $AppDir 'python\python.exe'
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
$PgPort           = 5432
$RedisPort        = 6379
$ApiPort          = 8000
$NginxPort        = 8080

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

function Save-State {
    param([hashtable]$State)
    if (-not (Test-Path $DataRoot)) { New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null }
    $State | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
}

function Get-State {
    if (Test-Path $StateFile) { return (Get-Content $StateFile -Raw | ConvertFrom-Json) }
    return $null
}
