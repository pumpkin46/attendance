# Windows install (EXE setup)

This repo is a multi-service local stack:

- `backend/` (Laravel API, default `http://127.0.0.1:8000`)
- `ai-service/` (FastAPI, default `http://127.0.0.1:8001`)
- `frontend/` (React UI, served locally on `http://127.0.0.1:5173`)

To make it feel like a single “Windows app”, we ship:

1) an **EXE installer** (Inno Setup) and
2) a **tray launcher** (`AttendanceLauncher.exe`) that starts/stops the services and opens the UI.

## What gets installed

Installed to: `%ProgramFiles%\\Attendance Platform\\` (default)

- App code: `backend/`, `frontend/`, `ai-service/`\n+- Tray launcher: `launcher/AttendanceLauncher.exe`\n+- Bootstrap scripts: `windows/scripts/*.ps1`
- App code: `backend/`, `frontend/`, `ai-service/`
- Tray launcher: `launcher/AttendanceLauncher.exe`
- Bootstrap scripts: `windows/scripts/*.ps1`

Logs are written to:
`%LOCALAPPDATA%\\AttendancePlatform\\logs\\`

## Installer entrypoint

- Inno Setup script: [windows/installer/inno/attendance.iss](windows/installer/inno/attendance.iss)
- Bootstrap script executed post-copy:
  - `windows/scripts/bootstrap.ps1`

## What the bootstrap does

`bootstrap.ps1` runs these steps (idempotent):

1. `install_prereqs.ps1`
   - placeholder for bundling/installing:
     - PHP + Composer
     - Python
     - Node.js (build-time)
   - PostgreSQL and Redis are **optional** (not required).
2. `build_app.ps1`
   - `backend`: `composer install`
   - `frontend`: `npm ci && npm run build` (creates `frontend/dist`)
   - `ai-service`: create venv + `pip install -r requirements.txt`
3. `configure_and_migrate.ps1`
   - creates/updates `backend/.env` from `backend/.env.example`
   - ensures `AI_SERVICE_URL=http://127.0.0.1:8001`
   - defaults to **SQLite** if PostgreSQL isn’t reachable
   - enables Redis drivers if Redis is reachable; otherwise uses file/sync
   - `php artisan key:generate` (if missing)
   - `php artisan migrate --seed --force`
4. `prewarm_models.ps1` (best-effort)
   - downloads anti-spoof ONNX model
   - warms InsightFace weights

## Running the installed app

Launch **Attendance Platform** from the Start Menu. The tray app will:

- Start ai-service: `uvicorn main:app --host 127.0.0.1 --port 8001`
- Start backend: `php artisan serve --host 127.0.0.1 --port 8000`
- Serve UI from `frontend/dist` via Python’s `http.server` on port `5173`
- Open your browser to `http://127.0.0.1:5173`

## Rebuilding the installer

1. Build the launcher:
   - `dotnet build -c Release windows/launcher/AttendanceLauncher.sln`
2. Open `windows/installer/inno/attendance.iss` in **Inno Setup Compiler**
3. Compile → produces `AttendancePlatformSetup.exe`

