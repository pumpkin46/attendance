# AttendanceLauncher (Windows tray app)

This is a minimal Windows tray launcher for the Attendance Platform. It starts:

- **Backend** via `uvicorn` on `127.0.0.1:8000` (from `backend/`)
- **UI** via nginx on `http://attendance.local` (serves `frontend/dist`, proxies `/api/` to the backend)

Logs are written under:

`%LOCALAPPDATA%\AttendancePlatform\logs\`

## Build (developer)

Open a terminal in this folder and run:

```bat
dotnet build -c Release
```

## Notes

- PostgreSQL and Redis are installed by the setup wizard (or must already be running on localhost).
- End users do not need Node.js or PHP at runtime.
