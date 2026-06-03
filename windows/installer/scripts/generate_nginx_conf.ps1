param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [string]$Domain = "attendance.local",
  [int]$UiPort = 80,
  [int]$BackendPort = 8000
)

$nginxDir = Join-Path $InstallRoot "windows\runtime\nginx"
$confPath = Join-Path $nginxDir "conf\nginx.conf"
$distPath = (Join-Path $InstallRoot "frontend\dist") -replace '\\', '/'
$logsPath = (Join-Path $nginxDir "logs") -replace '\\', '/'
$tempPath = (Join-Path $nginxDir "temp") -replace '\\', '/'

if (-not (Test-Path (Join-Path $nginxDir "nginx.exe"))) {
  throw "nginx.exe not found at $nginxDir"
}

foreach ($d in @("logs", "temp", "temp/client_body", "temp/proxy", "temp/fastcgi", "temp/uwsgi", "temp/scgi")) {
  $p = Join-Path $nginxDir $d
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

$conf = @"
worker_processes  1;
error_log  "$logsPath/error.log" warn;
pid        "$logsPath/nginx.pid";

events {
    worker_connections  256;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    access_log  "$logsPath/access.log";

    sendfile        on;
    keepalive_timeout  65;

    client_body_temp_path "$tempPath/client_body";
    proxy_temp_path       "$tempPath/proxy";
    fastcgi_temp_path     "$tempPath/fastcgi";
    uwsgi_temp_path       "$tempPath/uwsgi";
    scgi_temp_path        "$tempPath/scgi";

    gzip  on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_min_length 256;

    server {
        listen       127.0.0.1:$UiPort;
        server_name  $Domain;

        root "$distPath";
        index index.html;

        # Fingerprinted assets — cache forever
        location /assets/ {
            expires max;
            add_header Cache-Control "public, immutable";
        }

        # API proxy to Python backend
        location /api/ {
            proxy_pass http://127.0.0.1:$BackendPort;
            proxy_set_header Host `$host;
            proxy_set_header X-Real-IP `$remote_addr;
            proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto `$scheme;
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
            client_max_body_size 50m;
        }

        # SPA fallback — serve index.html for all non-file routes
        location / {
            try_files `$uri `$uri/ /index.html;
        }

        location /.well-known/ {
            return 204;
        }
    }
}
"@

# nginx for Windows treats UTF-8 BOM as an unknown character.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($confPath, $conf, $utf8NoBom)
Write-Host "nginx.conf generated at: $confPath"
