# Offline prereq installers

These installers are **not stored in git** (too large for GitHub). Download them locally before building `attendance.iss`.

If you want the installer UI to be able to install PostgreSQL and Redis, place the offline installers here **before** compiling `attendance.iss`:

- `windows/installer/prereqs/postgresql/postgresql-installer.exe`
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

