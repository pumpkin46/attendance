# Windows packaging

## Launcher (tray app)

- Project: [windows/launcher/AttendanceLauncher](windows/launcher/AttendanceLauncher)\n+- Output: `windows/launcher/AttendanceLauncher/bin/Release/net8.0-windows/AttendanceLauncher.exe`

The launcher starts:

- Backend (Laravel): `http://127.0.0.1:8000`\n+- AI service (FastAPI): `http://127.0.0.1:8001`\n+- UI (static server): `http://127.0.0.1:5173`

PostgreSQL and Redis are **optional**. The bootstrap defaults to SQLite + file/sync drivers unless Postgres/Redis are detected on localhost.

## Installer (Inno Setup)

- Script: [windows/installer/inno/attendance.iss](windows/installer/inno/attendance.iss)\n+- Bootstrap scripts copied into install dir: `windows/installer/scripts/*.ps1`

### Build steps (manual)

1. Build launcher:\n+   - `dotnet build -c Release windows/launcher/AttendanceLauncher.sln`\n+2. Compile Inno Setup script `attendance.iss`\n+
## Startup flow

See: [windows/launch-flow.md](windows/launch-flow.md)

