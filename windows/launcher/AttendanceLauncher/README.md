# AttendanceLauncher (Windows tray app)

This is a minimal Windows tray launcher for the Attendance Platform. It starts:

- `ai-service` via `uvicorn` on `127.0.0.1:8001`
- `backend` via `php artisan serve` on `127.0.0.1:8000`
- the UI by serving `frontend/dist` on `127.0.0.1:5173`

Logs are written under:

`%LOCALAPPDATA%\AttendancePlatform\logs\`

## Build (developer)

Open a terminal in this folder and run:

```bat
dotnet build -c Release
```

## Notes

- Postgres/Redis start/health checks are added in the installer integration step.
- The UI server currently uses `npx serve`. The installer will bundle a known static server so Node tooling is not required at runtime.

