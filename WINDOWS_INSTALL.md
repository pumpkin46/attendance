# Windows install (EXE setup)

This repo runs as a local stack on Windows:

- `backend/` — Python API + face recognition (FastAPI, default `http://127.0.0.1:8000`)
- `frontend/` — React UI, served via nginx at `http://attendance.local`

To make it feel like a single “Windows app”, we ship:

1) an **EXE installer** (Inno Setup) and
2) a **tray launcher** (`AttendanceLauncher.exe`) that starts/stops the services and opens the UI.

## What gets installed

Installed to: `%ProgramFiles%\Attendance Platform\` (default)

- App code: `frontend/`, `backend/`
- Tray launcher: `launcher/AttendanceLauncher.exe`
- Bootstrap scripts: `windows/scripts/*.ps1`

Logs are written to:
`%LOCALAPPDATA%\AttendancePlatform\logs\`

## Installer entrypoint

- Inno Setup script: [windows/installer/inno/attendance.iss](windows/installer/inno/attendance.iss)
- Bootstrap script executed post-copy:
  - `windows/scripts/bootstrap.ps1`

## What the bootstrap does

`bootstrap.ps1` runs these steps (idempotent):

1. `install_prereqs.ps1`
   - Python (optional via installer UI)
   - PostgreSQL and Redis (optional via installer UI; **required** for production config)
   - nginx (extracted for UI + API reverse proxy)
2. `build_app.ps1`
   - Verifies `frontend/dist` exists (built at packaging time)
   - `backend`: create venv + `pip install -r requirements.txt`
3. `configure_and_migrate.ps1`
   - creates/updates `backend/.env` from `.env.example`
   - requires PostgreSQL + Redis on localhost (or install them via the wizard)
   - `alembic upgrade head` + `seed.py`
4. `prewarm_models.ps1` (best-effort)
   - downloads anti-spoof ONNX model
   - warms InsightFace weights

## Running the installed app

Launch **Attendance Platform** from the Start Menu. The tray app will:

- Start backend: `uvicorn main:app --host 127.0.0.1 --port 8000`
- Start nginx: serves `frontend/dist` and proxies `/api/` to the Python backend
- Open your browser to `http://attendance.local`

### Bundled Python (no system install required)

The launcher prefers:

- `windows/runtime/python/python.exe` (installed by the setup wizard)

If missing, it falls back to:

- `backend/.venv/Scripts/python.exe` (created during install)

### Node.js on end-user PCs

End users do **not** need Node.js. The installer expects `frontend/dist` to be included in the package (prebuilt).

### Offline prerequisites to bundle

To support offline installation on a clean PC, place these files before compiling the setup EXE:

- `windows/installer/prereqs/python/python-3.14.4-amd64.exe`
- `windows/installer/prereqs/nginx/nginx-1.30.2.zip`
- `windows/installer/prereqs/redis/memurai.msi` (Redis-compatible for Windows)
- `windows/installer/prereqs/postgresql/postgresql-installer.exe`

## Rebuilding the installer

1. Build the frontend (`cd frontend && npm ci && npm run build`).
2. Build the launcher:
   - `dotnet build -c Release windows/launcher/AttendanceLauncher.sln`
3. Open `windows/installer/inno/attendance.iss` in **Inno Setup Compiler**
4. Compile → produces `AttendancePlatformSetup.exe`

## One-command build

If you have Inno Setup installed (so `ISCC.exe` is available), run from repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1
```

If `ISCC.exe` is not on PATH, pass it explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1 -InnoSetupIsccPath "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```
