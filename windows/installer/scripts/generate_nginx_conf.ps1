# generate_nginx_conf.ps1 - write nginx.conf that serves the static frontend and
# reverse-proxies /api/v1 (REST + WebSocket) to the uvicorn backend.
. "$PSScriptRoot\common.ps1"

# nginx on Windows accepts forward slashes; absolute paths avoid prefix ambiguity.
function To-Nginx([string]$p) { return ($p -replace '\\', '/') }

$confDir = Join-Path $NginxDir 'conf'
if (-not (Test-Path $confDir)) { throw "nginx conf dir not found: $confDir" }
$confPath = Join-Path $confDir 'nginx.conf'

$root      = To-Nginx $FrontendDir
$mime      = To-Nginx (Join-Path $confDir 'mime.types')
$errLog    = To-Nginx (Join-Path $LogDir 'nginx-error.log')
$accLog    = To-Nginx (Join-Path $LogDir 'nginx-access.log')
# pid + temp live under the user-writable appdata dir so a non-elevated tray
# launcher can run nginx. (NOT $pid - $PID is a read-only automatic variable.)
$pidPath   = To-Nginx (Join-Path $AppDataDir 'nginx.pid')
$tmp       = To-Nginx (Join-Path $AppDataDir 'nginx-temp')

Initialize-Logging

$conf = @"
worker_processes  1;
error_log  "$errLog"  warn;
pid        "$pidPath";

events { worker_connections 1024; }

http {
    include       "$mime";
    default_type  application/octet-stream;
    access_log    "$accLog";

    sendfile           on;
    keepalive_timeout  65;
    client_max_body_size 50m;        # face enrollment image batches

    client_body_temp_path "$tmp/client_body";
    proxy_temp_path       "$tmp/proxy";
    fastcgi_temp_path     "$tmp/fastcgi";
    uwsgi_temp_path       "$tmp/uwsgi";
    scgi_temp_path        "$tmp/scgi";

    map `$http_upgrade `$connection_upgrade { default upgrade; '' close; }

    server {
        listen       $NginxPort;
        server_name  localhost;
        root         "$root";
        index        index.html;

        # Security headers. The CSP blunts XSS (the session JWT lives in
        # localStorage) and forbids framing. Tuned for the Vite/React/Tailwind
        # build: external module scripts ('self'), inline styles from the UI
        # libs ('unsafe-inline' style), webcam frames as blob/data URLs, and
        # same-origin API + WebSocket (connect-src 'self').
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # REST API + WebSocket (/api/v1/ws) - same prefix, same upstream.
        location /api/v1/ {
            proxy_pass http://127.0.0.1:$ApiPort;
            proxy_http_version 1.1;
            proxy_set_header Host              `$host;
            proxy_set_header X-Real-IP         `$remote_addr;
            proxy_set_header X-Forwarded-For   `$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto `$scheme;
            proxy_set_header Upgrade           `$http_upgrade;
            proxy_set_header Connection        `$connection_upgrade;
            proxy_read_timeout 3600s;
        }

        # SPA fallback - serve index.html for client-side routes.
        location / {
            try_files `$uri /index.html;
        }
    }
}
"@

Write-Log "Writing nginx.conf ($confPath) ..."
Set-Content -Path $confPath -Value $conf -Encoding ascii
Write-Log "nginx.conf written (listen $NginxPort -> 127.0.0.1:$ApiPort)."
