# AI Attendance Platform

Enterprise-grade attendance system with face recognition, liveness detection, RBAC, multi-location support, and automated check-in/out. Runs locally without Docker.

> **Using the app?** The [User Guide](docs/USER_GUIDE.md) is a step-by-step walkthrough of every screen — first-run setup, sign-in, face enrollment, the check-in kiosk, attendance, devices, reports, and administration.

## Architecture

```
Web UI (React)  →  API (FastAPI / backend)  →  PostgreSQL + Redis
                              ↓
                    Face recognition (InsightFace, FAISS, anti-spoof)
```

The **`backend/`** service is the unified API: REST, attendance engine, and face recognition on a single process (default port **8000**).

| Layer | Stack |
|-------|--------|
| Frontend | React 19, TypeScript, Vite |
| Backend | FastAPI, SQLAlchemy, PostgreSQL, Redis, InsightFace, FAISS |

## Prerequisites

- **PostgreSQL 14+**
- **Redis 6+**
- **Node.js 20+** (frontend dev/build only)
- **Python 3.14+** (Windows installer bundles 3.14.4)

## 1. Database

```bash
createdb attendance
```

## 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set DB_PASSWORD, and generate a real JWT_SECRET:
#   python -c "import secrets; print(secrets.token_hex(64))"
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
alembic upgrade head
python seed.py
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

API runs at **http://127.0.0.1:8000**

Default admin: `admin@attendance.local` / `password`

> Uses **InsightFace**, **FAISS**, **FastAPI**, **ONNX Runtime**. Models (`buffalo_l`) download on first run. Without models, a deterministic mock embedding mode is used for development.

## 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

UI runs at **http://127.0.0.1:5173** (proxies API to port 8000 via `VITE_API_URL`).

## Core modules

| Module | Description |
|--------|-------------|
| Authentication & RBAC | JWT tokens, roles, permissions |
| Employee Management | CRUD, departments, locations |
| Face Enrollment | Upload photo → embedding → FAISS index |
| Face Recognition | Identify + liveness → auto attendance |
| RFID Integration | Card tap at readers → auto check-in/out |
| Attendance Engine | Check-in/out, duplicate prevention, overtime |
| Anomaly Detection | Rules + Isolation Forest on attendance patterns |
| Shift Management | Schedules, grace periods, assignments |
| Reporting | Attendance + security-alert exports (CSV / Excel / PDF) |
| Camera Management | Multi-camera, heartbeat monitoring |
| Edge camera mode | On-device backend + FAISS embedding sync |
| Audit Logs | Sensitive actions logged |
| AI Security Monitoring | Unknown persons, spoof, after-hours and tailgating alerts |
| Autonomous Visitor Kiosks | Self-service walk-in, face enroll, badge check-in |

## Recognition flow

1. Camera or kiosk sends base64 image to `POST /api/v1/recognition/identify`
2. API runs embedding match (cosine ≥ `RECOGNITION_THRESHOLD`, default 0.5) and liveness check
3. Attendance engine records check-in or check-out (60s duplicate window)
4. Unknown faces logged as security alerts

## RFID flow

1. Admin registers an RFID reader (location + direction) and receives a one-time API token
2. Admin assigns card UIDs to employees in the UI
3. Physical reader POSTs to `POST /api/v1/rfid/tap` with `Authorization: Bearer <token>` and body `{ "uid": "A1B2C3D4" }`
4. API looks up the card and records check-in or check-out

## Edge cameras (optional)

For on-site inference, set a camera to **edge** deployment mode and run a local `backend` instance (e.g. port 8001). Sync the FAISS index with `GET /api/v1/embeddings/export` and `POST /api/v1/embeddings/import` so recognition runs without streaming video to the central server.

## Accuracy measurement & compliance

Accuracy, false-positive rate, and false-negative rate can only be *measured*
against ground truth, so the platform collects labeled outcomes two ways:

1. **Event feedback** — reviewers label recognition events as correct/incorrect
   (`POST /api/v1/recognition/events/{id}/feedback`, surfaced in the Unknown
   Faces review modal). A wrongly-rejected enrolled person counts as a false
   reject; a confirmed stranger as a true reject.
2. **Offline evaluation** — `POST /api/v1/recognition/evaluate` runs a labeled
   probe set (genuine + impostor images) through the live pipeline and index
   and scores accuracy / FPR / FNR / latency.

`GET /api/v1/recognition/performance-compliance` reports the required targets
(accuracy ≥ 99 %, FPR < 0.1 %, FNR < 1 %, recognition < 300 ms, liveness
< 500 ms) against measured values; the AI Engine page shows the same table
under **Required performance metrics**.

## Anomaly detection

1. API gathers attendance features (check-in time, overtime, recognition frequency, etc.)
2. Rule-based checks + **Isolation Forest** ML outlier detection
3. Anomalies stored in `attendance_anomalies` for HR review

## Security notes

- Use **TLS 1.3** in production (reverse proxy: nginx, Caddy, or IIS)
- Set `APP_ENV=production` and a strong `JWT_SECRET` in production
- Passwords hashed with **Argon2id**
- Rotate secrets per environment; enable PostgreSQL SSL by setting `DB_SSLMODE=require` (applied to both the async and sync database URLs)

## Non-functional requirements (NFR)

| ID | Requirement | Implementation |
|----|-------------|----------------|
| **NFR-001** | Recognition < 500 ms/face | `RECOGNITION_SLA_MS=500`; API returns `sla_met` |
| **NFR-002** | 10,000 employees | `MAX_EMPLOYEES=10000`; FAISS flat index |
| **NFR-003** | 100 cameras | `MAX_CAMERAS=100`; stream poll + heartbeat |
| **NFR-004** | 99.9% uptime | `GET /api/v1/health` and `GET /up` |
| **NFR-005** | Horizontal scaling | Stateless API; Redis in production |
| **NFR-008** | GDPR compliance | Retention purge API; privacy endpoints |

Check compliance: `GET http://127.0.0.1:8000/api/v1/health`

## Backup & restore

Face embeddings live **outside** PostgreSQL: the FAISS index (`INDEX_PATH`,
default `data/faiss.index`) and its metadata (`METADATA_PATH`, default
`data/metadata.json`). A database row references an embedding by FAISS id, so
restoring one store without the other leaves attendance/enrollment rows and
vectors out of sync (recognitions then mis-resolve or 404).

Back them up as a single consistent unit:

1. `pg_dump` the PostgreSQL database, and
2. snapshot the `data/` directory (FAISS index + metadata),

taken at the same time (ideally with the API stopped, or right after a quiet
period). Restore both together; never restore just one.

## Windows installer (offline)

A single `AttendancePlatformSetup.exe` installs and runs the whole platform on an
**offline** Windows PC — Python, PostgreSQL, nginx, all dependencies, and the
face-recognition models are bundled. PostgreSQL runs as a Windows service; a
system-tray launcher controls the backend and nginx (which serves the UI on
`http://localhost:8080`).

- **Build** the setup EXE (online build machine): [WINDOWS_BUILD.md](WINDOWS_BUILD.md)
- **Install / run** on end-user PCs (offline): [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md)

## Project structure

```
attendance/
├── backend/       # FastAPI API + face recognition
├── frontend/      # React admin UI
└── windows/       # Offline installer toolchain + tray launcher
```
