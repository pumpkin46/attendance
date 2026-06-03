# Windows packaging

## Launcher (tray app)

- Project: [windows/launcher/AttendanceLauncher](windows/launcher/AttendanceLauncher)
- Output: `windows/launcher/AttendanceLauncher/bin/Release/net8.0-windows/AttendanceLauncher.exe`

The launcher starts:

- **Backend + AI** (Python / uvicorn): `http://127.0.0.1:8000`
- **Web server** (nginx): `http://attendance.local` (UI + `/api/` proxy)

PostgreSQL and Redis are required for the default installer configuration (the bootstrap configures `DATABASE_URL` and `REDIS_URL` for localhost).

## Installer (Inno Setup)

- Script: [windows/installer/inno/attendance.iss](windows/installer/inno/attendance.iss)
- Bootstrap scripts copied into install dir: `windows/installer/scripts/*.ps1`

### Build steps (manual)

1. Build frontend: `npm ci && npm run build` in `frontend/`
2. Build launcher: `dotnet build -c Release windows/launcher/AttendanceLauncher.sln`
3. Compile Inno Setup script `attendance.iss`

## Startup flow

See: [windows/launch-flow.md](windows/launch-flow.md)
