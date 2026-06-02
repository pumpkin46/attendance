## Windows launcher: startup order + health checks

This project runs as a local multi-process stack:

- **Database**: SQLite by default; optional PostgreSQL (`127.0.0.1:5432`)
- **Cache/queue**: file/sync by default; optional Redis (`127.0.0.1:6379`)
- **Laravel backend** (default `http://127.0.0.1:8000`)
- **FastAPI ai-service** (default `http://127.0.0.1:8001`)
- **React UI** (default `http://127.0.0.1:5173`) with `VITE_API_URL=http://127.0.0.1:8000/api/v1`

The Windows tray launcher should treat **backend + ai-service + UI** as the “app”. PostgreSQL/Redis are **optional**: if present, enable them; otherwise run with SQLite + file/sync drivers.

### Ports (defaults)

- Backend: `8000`
- AI service: `8001`
- UI: `5173` (note: frontend dev server also uses 5173 in `frontend/vite.config.ts`)

### Startup sequence (recommended)

1. **(Optional) Detect Postgres**
   - If `127.0.0.1:5432` is reachable and credentials are configured, use PostgreSQL.
   - Otherwise default to SQLite (`backend/database/database.sqlite`).

2. **(Optional) Detect Redis**
   - If `127.0.0.1:6379` is reachable, enable redis cache/queue/session.
   - Otherwise use file/sync drivers.

3. **Prepare backend config**
   - Ensure `backend/.env` exists (copy from `backend/.env.example` if needed).
   - Ensure `APP_KEY` exists (if empty, run `php artisan key:generate`).
   - Ensure DB + optional Redis settings are correct for the detected runtime.
   - Ensure `AI_SERVICE_URL=http://127.0.0.1:8001`.

4. **Initialize/upgrade database (one-time)**
   - Run `php artisan migrate --seed` (idempotent).
   - If migrations fail, surface logs and stop.

5. **Start AI service (FastAPI)**
   - Command (from `ai-service/` with venv activated):
     - `uvicorn main:app --host 127.0.0.1 --port 8001`
   - Health check: `GET http://127.0.0.1:8001/health` expects JSON with `"status":"ok"`.

6. **Start backend (Laravel)**
   - Command (from `backend/`):
     - `php artisan serve --host 127.0.0.1 --port 8000`
   - Health check: `GET http://127.0.0.1:8000/up` (Laravel health endpoint) OR `GET http://127.0.0.1:8000/api/v1/health` if present.

7. **Start UI**
   - Preferred for “installed” app: serve `frontend/dist` as static files on `127.0.0.1:5173`.
   - Health check: HTTP `GET http://127.0.0.1:5173/` returns `200`.
   - Open default browser to `http://127.0.0.1:5173`.

### Shutdown sequence (recommended)

1. Stop UI static server
2. Stop backend
3. Stop AI service
4. No DB/cache processes are required. If the machine has Postgres/Redis, the launcher should not stop them.

### Process supervision + logging

- Launch each component with stdout/stderr redirected to log files (rotated by date/size).
- If a child process exits unexpectedly:
  - Update tray icon to “error”
  - Keep launcher running
  - Provide “View logs” action
  - Provide “Restart” action

