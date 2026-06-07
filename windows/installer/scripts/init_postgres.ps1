# init_postgres.ps1 - initialize a portable PostgreSQL cluster, register it as a
# Windows service, start it, and create the application database.
#
#   -DbPassword  superuser password to set during initdb (passed by bootstrap.ps1)
param([Parameter(Mandatory = $true)][string]$DbPassword)

. "$PSScriptRoot\common.ps1"

$initdb = Join-Path $PgBin 'initdb.exe'
$pgctl  = Join-Path $PgBin 'pg_ctl.exe'
$psql   = Join-Path $PgBin 'psql.exe'
foreach ($exe in @($initdb, $pgctl, $psql)) {
    if (-not (Test-Path $exe)) { throw "PostgreSQL binary missing: $exe" }
}

if (-not (Test-Path $DataRoot)) { New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null }
Initialize-Logging

# -- initdb (only if the cluster does not already exist) ----------------------
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    Write-Log "Initializing PostgreSQL cluster at $PgData ..."
    $pwfile = Join-Path $env:TEMP ("pgpw_" + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        Set-Content -Path $pwfile -Value $DbPassword -NoNewline -Encoding ascii
        $code = Invoke-Logged -FilePath $initdb -LogFile (Join-Path $LogDir 'postgres-init.log') -ArgumentList @(
            '-D',$PgData,'-U',$DbUser,"--pwfile=$pwfile",'-E','UTF8','-A','scram-sha-256','--locale=C')
        if ($code -ne 0) { throw "initdb failed ($code)." }
    } finally {
        Remove-Item $pwfile -Force -ErrorAction SilentlyContinue
    }

} else {
    Write-Log "Existing PostgreSQL cluster found at $PgData - skipping initdb."
}

# -- Enforce loopback + our dedicated port on EVERY run (idempotent) ----------
# Strip any prior uncommented listen_addresses/port lines, then append ours, so
# the bundled server never collides with another PostgreSQL on the default 5432.
$conf = Join-Path $PgData 'postgresql.conf'
$kept = Get-Content $conf | Where-Object { $_ -notmatch '^\s*(listen_addresses|port)\s*=' }
($kept + @("listen_addresses = '127.0.0.1'", "port = $PgPort")) | Set-Content -Path $conf -Encoding ascii

# -- Register the service if needed, then (re)start so the config takes effect -
$svc = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Log "Registering Windows service '$PgServiceName' ..."
    $code = Invoke-Logged -FilePath $pgctl -LogFile (Join-Path $LogDir 'postgres-init.log') -ArgumentList @(
        'register','-N',$PgServiceName,'-D',$PgData,'-S','auto','-w')
    if ($code -ne 0) { throw "pg_ctl register failed ($code)." }
}

Write-Log "Starting PostgreSQL service on port $PgPort ..."
if ((Get-Service -Name $PgServiceName).Status -eq 'Running') {
    Stop-Service -Name $PgServiceName -Force -ErrorAction SilentlyContinue
}
Start-Service -Name $PgServiceName -ErrorAction SilentlyContinue

# Wait until OUR cluster (on $PgPort) accepts connections.
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    & (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p $PgPort -q
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL did not become ready on 127.0.0.1:$PgPort (port in use or service failed - see postgres-init.log)." }

# -- Create the application database (idempotent) -----------------------------
$env:PGPASSWORD = $DbPassword
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$exists = (& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null | Out-String).Trim()
$ErrorActionPreference = $prev
if ($exists -ne '1') {
    Write-Log "Creating database '$DbName' ..."
    $code = Invoke-Logged -FilePath (Join-Path $PgBin 'createdb.exe') -LogFile (Join-Path $LogDir 'postgres-init.log') `
        -ArgumentList @('-h','127.0.0.1','-p',"$PgPort",'-U',$DbUser,$DbName)
    if ($code -ne 0) { throw "createdb failed ($code). See postgres-init.log." }
} else {
    Write-Log "Database '$DbName' already exists."
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

Write-Log "PostgreSQL ready on 127.0.0.1:$PgPort."
