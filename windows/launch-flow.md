## Windows launcher: startup order + health checks

This project runs as a local multi-process stack on Windows:

- **PostgreSQL** (`127.0.0.1:5432`) — required for default installer config
- **Redis** (`127.0.0.1:6379`) — required for default installer config
- **Python backend + AI** (FastAPI, `http://127.0.0.1:8000`)
- **nginx** (`http://attendance.local`) — serves `frontend/dist`, proxies `/api/` to port 8000

The Windows tray launcher treats **backend + nginx** as the “app”. PostgreSQL and Redis are installed separately (installer wizard or pre-existing).

### Ports (defaults)

- Backend (uvicorn): `8000`
- UI (nginx): `80` on `attendance.local` (`127.0.0.1`)

### Startup sequence (recommended)

1. **Verify PostgreSQL**
   - `127.0.0.1:5432` must be reachable (installed by wizard or already present).

2. **Verify Redis**
   - `127.0.0.1:6379` must be reachable.

3. **Prepare backend config**
   - Ensure `backend/.env` exists (copy from `.env.example` if needed).
   - Set `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` as needed.

4. **Initialize/upgrade database (one-time)**
   - Run `alembic upgrade head` and `python seed.py` (idempotent).
   - If migrations fail, surface logs and stop.

5. **Start backend (FastAPI)**
   - Command (from `backend/` with venv activated):
     - `uvicorn main:app --host 127.0.0.1 --port 8000`
   - Health check: `GET http://127.0.0.1:8000/up`

6. **Start nginx**
   - `nginx.exe -c conf/nginx.conf` from `windows/runtime/nginx`
   - Health check: `GET http://attendance.local/` returns `200`
   - Open default browser to `http://attendance.local`

### Shutdown sequence (recommended)

1. Stop nginx (`nginx -s quit`)
2. Stop uvicorn / Python backend process
3. Do not stop PostgreSQL or Redis (shared services).

### Process supervision + logging

- Launch each component with stdout/stderr redirected to log files (rotated by date/size).
- If a child process exits unexpectedly:
  - Update tray icon to “error”
  - Keep launcher running
  - Provide “View logs” action
  - Provide “Restart” action
