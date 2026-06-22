# bootstrap.ps1 - post-install orchestrator, run elevated by the Inno Setup
# installer. Performs the full offline setup on the target machine. Idempotent:
# safe to re-run (e.g. repair installs).
. "$PSScriptRoot\common.ps1"

Initialize-Logging
Write-Log "=== Attendance Platform bootstrap starting ==="
Write-Log "AppDir = $AppDir"

try {
    # Reuse credentials from a previous install if present, else generate fresh.
    # No admin password is generated here: the first administrator account is
    # created by the in-app /setup wizard, not seeded by the installer.
    $state = Get-State
    if ($state -and $state.DbPassword -and $state.JwtSecret) {
        Write-Log "Reusing credentials from previous install state."
        $dbPassword = $state.DbPassword
        $jwtSecret  = $state.JwtSecret
    } else {
        Write-Log "Generating new credentials."
        Add-Type -AssemblyName System.Web
        $dbPassword = [System.Web.Security.Membership]::GeneratePassword(32, 6) -replace "[^A-Za-z0-9]", "x"
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $jwtSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        Save-State @{ DbPassword = $dbPassword; JwtSecret = $jwtSecret; NginxPort = $NginxPort; ApiPort = $ApiPort; PgPort = $PgPort }
    }

    & "$PSScriptRoot\install_python.ps1"
    & "$PSScriptRoot\create_venv.ps1"
    & "$PSScriptRoot\init_postgres.ps1" -DbPassword $dbPassword
    & "$PSScriptRoot\init_redis.ps1"
    & "$PSScriptRoot\configure_env.ps1" -DbPassword $dbPassword -JwtSecret $jwtSecret
    # Schema migrations and the first-admin account are intentionally NOT run
    # here. The backend boots against the (empty) database it created above and
    # its first-run /setup wizard applies the migrations and creates the admin.
    & "$PSScriptRoot\generate_nginx_conf.ps1"

    # First run is driven by the in-app setup wizard (it creates the database
    # schema and the first administrator account), so there is no pre-seeded
    # login to hand the operator - just point them at the URL.
    $firstRunFile = Join-Path $DataRoot 'FIRST_RUN.txt'
    @(
        "Attendance Platform - first-run setup"
        "URL: http://localhost:$NginxPort"
        ""
        "Open the URL above. On first launch the app shows a short setup wizard"
        "that creates the database schema and your first administrator account."
        "You choose the admin email and password there - there is no default login."
        ""
        "Delete this file once setup is complete."
    ) | Set-Content -Path $firstRunFile -Encoding utf8
    Write-Log "Wrote first-run instructions to $firstRunFile"

    # Writable runtime data lives under ProgramData (FAISS index, uploads,
    # snapshots, the Celery beat schedule, nginx pid/temp, runtime logs). Create
    # the dirs and grant the Users group modify rights so the (possibly
    # non-elevated) tray launcher can write there.
    foreach ($sub in @('', 'uploads', 'snapshots\unknown', 'nginx-temp')) {
        $d = if ($sub) { Join-Path $AppDataDir $sub } else { $AppDataDir }
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    }
    foreach ($grantDir in @($AppDataDir, $LogDir)) {
        $null = Invoke-Logged -FilePath 'icacls.exe' -LogFile (Join-Path $LogDir 'install.log') -ArgumentList @(
            $grantDir, '/grant', '*S-1-5-32-545:(OI)(CI)M', '/T', '/Q')
    }

    Write-Log "=== Bootstrap completed successfully ==="
    exit 0
}
catch {
    Write-Log "BOOTSTRAP FAILED: $($_.Exception.Message)" 'ERROR'
    Write-Log $_.ScriptStackTrace 'ERROR'
    exit 1
}
