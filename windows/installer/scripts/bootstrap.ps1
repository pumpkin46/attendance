# bootstrap.ps1 - post-install orchestrator, run elevated by the Inno Setup
# installer. Performs the full offline setup on the target machine. Idempotent:
# safe to re-run (e.g. repair installs).
. "$PSScriptRoot\common.ps1"

Initialize-Logging
Write-Log "=== Attendance Platform bootstrap starting ==="
Write-Log "AppDir = $AppDir"

try {
    # Reuse credentials from a previous install if present, else generate fresh.
    $state = Get-State
    if ($state -and $state.DbPassword -and $state.JwtSecret -and $state.AdminPassword) {
        Write-Log "Reusing credentials from previous install state."
        $dbPassword    = $state.DbPassword
        $jwtSecret     = $state.JwtSecret
        $adminPassword = $state.AdminPassword
    } else {
        Write-Log "Generating new credentials."
        Add-Type -AssemblyName System.Web
        $dbPassword    = [System.Web.Security.Membership]::GeneratePassword(32, 6) -replace "[^A-Za-z0-9]", "x"
        # Human-typable admin password (no ambiguous symbols), used for first login.
        $adminPassword = [System.Web.Security.Membership]::GeneratePassword(16, 0) -replace "[^A-Za-z0-9]", "x"
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $jwtSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        Save-State @{ DbPassword = $dbPassword; JwtSecret = $jwtSecret; AdminPassword = $adminPassword; NginxPort = $NginxPort; ApiPort = $ApiPort; PgPort = $PgPort }
    }

    & "$PSScriptRoot\install_python.ps1"
    & "$PSScriptRoot\create_venv.ps1"
    & "$PSScriptRoot\init_postgres.ps1" -DbPassword $dbPassword
    & "$PSScriptRoot\init_redis.ps1"
    & "$PSScriptRoot\configure_env.ps1" -DbPassword $dbPassword -JwtSecret $jwtSecret
    & "$PSScriptRoot\migrate_and_seed.ps1" -AdminPassword $adminPassword
    & "$PSScriptRoot\generate_nginx_conf.ps1"

    # Write the first-login credentials where the operator can find them.
    $credFile = Join-Path $DataRoot 'ADMIN_CREDENTIALS.txt'
    @(
        "Attendance Platform - administrator sign-in"
        "URL:      http://localhost:$NginxPort"
        "Email:    admin@attendance.local"
        "Password: $adminPassword"
        ""
        "A super-admin account (superadmin@attendance.local) uses the same password."
        "Change these after your first login. Delete this file once recorded."
    ) | Set-Content -Path $credFile -Encoding utf8
    Write-Log "Wrote first-login credentials to $credFile"

    # Writable runtime data lives under ProgramData (FAISS index, uploads,
    # snapshots, the Celery beat schedule). Create it and grant the Users group
    # modify rights so the non-elevated tray launcher can write there.
    foreach ($sub in @('', 'uploads', 'snapshots\unknown')) {
        $d = if ($sub) { Join-Path $AppDataDir $sub } else { $AppDataDir }
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    }
    & icacls.exe $AppDataDir /grant "*S-1-5-32-545:(OI)(CI)M" /T /Q 2>&1 |
        Tee-Object -FilePath (Join-Path $LogDir 'install.log') -Append | Out-Null

    Write-Log "=== Bootstrap completed successfully ==="
    exit 0
}
catch {
    Write-Log "BOOTSTRAP FAILED: $($_.Exception.Message)" 'ERROR'
    Write-Log $_.ScriptStackTrace 'ERROR'
    exit 1
}
