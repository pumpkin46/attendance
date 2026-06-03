# Windows packaging

Build the offline installer and tray launcher for Attendance Platform on Windows.

**Build guide (maintainers):** [WINDOWS_BUILD.md](../WINDOWS_BUILD.md)  
**End-user install:** [WINDOWS_INSTALL.md](../WINDOWS_INSTALL.md)

## Launcher (tray app)

- Project: [launcher/AttendanceLauncher](launcher/AttendanceLauncher)
- Build: `dotnet build -c Release windows/launcher/AttendanceLauncher.sln`
- Output: `launcher/AttendanceLauncher/bin/Release/net8.0-windows/AttendanceLauncher.exe`

The launcher starts:

- **Backend** (Python / uvicorn): `http://127.0.0.1:8000`
- **Web server** (nginx): `http://attendance.local` (UI + `/api/` proxy)

PostgreSQL and Redis are required for the default installer configuration (bootstrap sets `DATABASE_URL` and `REDIS_URL` for localhost).

## Installer (Inno Setup)

- Script: [installer/inno/attendance.iss](installer/inno/attendance.iss)
- One-command build: [build-installer.ps1](build-installer.ps1) (see [WINDOWS_BUILD.md](../WINDOWS_BUILD.md))
- Bootstrap scripts (copied into install dir as `windows/scripts/`): [installer/scripts/](installer/scripts/)
- Offline prereqs (not in git): [installer/prereqs/README.md](installer/prereqs/README.md)

## Startup flow

See [launch-flow.md](launch-flow.md).
