# Offline prereq installers

If you want the installer UI to be able to install PostgreSQL and Redis, place the offline installers here **before** compiling `attendance.iss`:

- `windows/installer/prereqs/postgresql/postgresql-installer.exe`
- `windows/installer/prereqs/redis/redis-installer.exe`

The installer will copy them to the install directory and `bootstrap.ps1` will run them when the user selects the checkboxes.

