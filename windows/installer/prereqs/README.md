# Offline prereq installers

These installers are **not stored in git** (too large for GitHub). Download them locally before building `attendance.iss`.

## PostgreSQL (server only, ~42 MB)

The setup no longer bundles the ~350 MB EDB graphical installer. Use a **server-only** zip (`bin`, `lib`, `share` — no pgAdmin, docs, or debug symbols).

**Recommended file** (place before compiling Inno Setup):

- `windows/installer/prereqs/postgresql/postgresql-server-windows-x64.zip`

**Create it** from the official EDB binaries archive:

```powershell
# Downloads postgresql-16.14-1-windows-x64-binaries.zip (~311 MB) if missing, then writes the slim zip
powershell -NoProfile -ExecutionPolicy Bypass -File windows/installer/scripts/prepare_postgresql_prereq.ps1
```

Source: [EDB PostgreSQL binaries](https://www.enterprisedb.com/download-postgresql-binaries)  
Direct URL (16.14): `https://get.enterprisedb.com/postgresql/postgresql-16.14-1-windows-x64-binaries.zip`

At install time the bootstrap extracts only the server tree under `{app}\windows\runtime\postgresql`, runs `initdb`, and registers the `AttendancePostgreSQL` Windows service (superuser `postgres` / password `postgres`).

## Other prereqs

If you want the installer UI to be able to install Redis, place:

- `windows/installer/prereqs/redis/memurai.msi`

To make the installer fully offline for normal users, also place:

- `windows/installer/prereqs/python/python-3.14.4-amd64.exe` (from https://www.python.org/downloads/windows/)
- `windows/installer/prereqs/nginx/nginx-1.30.2.zip` (stable Windows build from https://nginx.org/en/download.html)

The installer will copy them to the install directory and `bootstrap.ps1` will run them when the user selects the checkboxes.

To refresh nginx before building the installer:

```powershell
$ver = "1.30.2"  # update when a new stable release ships
$dest = "windows/installer/prereqs/nginx"
Invoke-WebRequest -Uri "https://nginx.org/download/nginx-$ver.zip" -OutFile "$dest/nginx-$ver.zip"
Remove-Item "$dest/nginx-*.zip" -Exclude "nginx-$ver.zip"
```
