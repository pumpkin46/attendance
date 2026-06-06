# init_redis.ps1 - install Memurai (Redis-compatible) from the bundled MSI and
# start its Windows service. Memurai backs cross-worker rate limiting / duplicate
# suppression / realtime pub-sub and is the Celery broker + result backend.
#
# NOTE: the bundled Memurai *Developer* Edition is licensed for development/testing
# only; production deployments require Memurai Enterprise (swap the MSI at build).
. "$PSScriptRoot\common.ps1"

Initialize-Logging

$msi = Get-ChildItem -Path $RedisDir -Filter '*.msi' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $msi) { throw "Memurai MSI not found in $RedisDir." }

# Install Memurai as an auto-start service on the loopback port (idempotent: the
# MSI is a no-op if the same version is already installed). PORT sets the listen
# port; ADD_FIREWALL_RULE=0 keeps it loopback-only.
$svc = Get-Service -Name $RedisServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Log "Installing Memurai from $($msi.Name) ..."
    $log = Join-Path $LogDir 'memurai-install.log'
    $args = @('/i', "`"$($msi.FullName)`"", '/quiet', '/norestart',
              "PORT=$RedisPort", 'ADD_FIREWALL_RULE=0',
              '/l*v', "`"$log`"")
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        throw "Memurai MSI install failed (exit $($p.ExitCode)). See $log."
    }
    $svc = Get-Service -Name $RedisServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { throw "Memurai service '$RedisServiceName' not present after install." }
}

Write-Log "Starting Memurai service ..."
Set-Service -Name $RedisServiceName -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name $RedisServiceName -ErrorAction SilentlyContinue

# Wait until the port accepts connections.
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $RedisPort)
        if ($c.Connected) { $c.Close(); $ready = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw "Memurai did not start listening on port $RedisPort." }

Write-Log "Memurai (Redis) ready on 127.0.0.1:$RedisPort."
