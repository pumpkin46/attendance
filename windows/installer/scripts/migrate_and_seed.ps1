# migrate_and_seed.ps1 - apply Alembic migrations and seed the default admin.
# Runs from the backend dir so .env, alembic.ini and relative paths resolve.
#   -AdminPassword  password set for both seeded accounts (admin + superadmin).
#                   seed.py refuses the well-known default when APP_ENV<>local,
#                   so we pass an explicit value via SEED_*_PASSWORD env vars.
param([Parameter(Mandatory = $true)][string]$AdminPassword)

. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $VenvPython)) { throw "Venv missing ($VenvPython). Run create_venv.ps1 first." }

Push-Location $BackendDir
try {
    Write-Log "Running database migrations (alembic upgrade head) ..."
    & $VenvPython -m alembic upgrade head 2>&1 |
        Tee-Object -FilePath (Join-Path $LogDir 'migrate.log') -Append
    if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed ($LASTEXITCODE). See $LogDir\migrate.log." }

    Write-Log "Seeding initial data (seed.py) ..."
    $env:SEED_ADMIN_PASSWORD = $AdminPassword
    $env:SEED_SUPERADMIN_PASSWORD = $AdminPassword
    try {
        & $VenvPython seed.py 2>&1 |
            Tee-Object -FilePath (Join-Path $LogDir 'migrate.log') -Append
        if ($LASTEXITCODE -ne 0) { throw "seed.py failed ($LASTEXITCODE). See $LogDir\migrate.log." }
    } finally {
        Remove-Item Env:\SEED_ADMIN_PASSWORD, Env:\SEED_SUPERADMIN_PASSWORD -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}

Write-Log "Migrations + seed complete."
