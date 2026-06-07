# uninstall_cleanup.ps1 - stop running processes and remove the PostgreSQL
# service. Run by Inno Setup's [UninstallRun] before files are deleted.
#   -PurgeData   also delete the pgdata cluster, logs and runtime data.
param([switch]$PurgeData)

. "$PSScriptRoot\common.ps1"
# Uninstall is best-effort: never let a service tool's stderr abort cleanup.
$ErrorActionPreference = 'Continue'

Write-Log "=== Uninstall cleanup starting (PurgeData=$PurgeData) ==="

# Stop tray launcher + child processes.
foreach ($name in @('AttendanceLauncher', 'nginx')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Log "Stopping process $($_.ProcessName) (PID $($_.Id))"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# uvicorn / celery run as python.exe - only stop ones from our bundled Python.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($PyHome, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object {
        Write-Log "Stopping backend python (PID $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# Stop + unregister the PostgreSQL service.
$svc = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Log "Stopping + removing service '$PgServiceName'"
    if ($svc.Status -ne 'Stopped') { Stop-Service -Name $PgServiceName -Force -ErrorAction SilentlyContinue }
    $pgctl = Join-Path $PgBin 'pg_ctl.exe'
    if (Test-Path $pgctl) {
        & $pgctl unregister -N $PgServiceName 2>&1 | Out-Null
    } else {
        # Fallback if binaries were already removed.
        & sc.exe delete $PgServiceName 2>&1 | Out-Null
    }
}

# Stop + uninstall Memurai (Redis) via its bundled MSI. If a different Memurai
# version is installed (one we didn't install), msiexec is a no-op and leaves it.
$rsvc = Get-Service -Name $RedisServiceName -ErrorAction SilentlyContinue
if ($rsvc) {
    Write-Log "Stopping + uninstalling Memurai service '$RedisServiceName'"
    if ($rsvc.Status -ne 'Stopped') { Stop-Service -Name $RedisServiceName -Force -ErrorAction SilentlyContinue }
    $msi = Get-ChildItem -Path $RedisDir -Filter '*.msi' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($msi) {
        & msiexec.exe /x "$($msi.FullName)" /quiet /norestart 2>&1 | Out-Null
    } else {
        & sc.exe delete $RedisServiceName 2>&1 | Out-Null
    }
}

if ($PurgeData) {
    Write-Log "Purging data directory $DataRoot"
    Remove-Item -Path $DataRoot -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Log "Leaving data directory in place: $DataRoot"
}

Write-Log "=== Uninstall cleanup done ==="
exit 0
