# AI Attendance Platform

Enterprise-grade attendance system with face recognition, liveness detection, RBAC, multi-location support, and automated check-in/out. Runs locally without Docker.

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
| Reporting | Summary, overtime, CSV export |
| Camera Management | Multi-camera, heartbeat monitoring |
| Edge camera mode | On-device backend + FAISS embedding sync |
| Audit Logs | Sensitive actions logged |
| Smart Building Integration | Webhook connectors for BMS events |
| AI Security Monitoring | Unknown persons, spoof, access denied alerts |
| Autonomous Visitor Kiosks | Self-service walk-in, face enroll, badge check-in |

## Recognition flow

1. Camera or kiosk sends base64 image to `POST /api/v1/recognition/identify`
2. API runs embedding match (threshold ≥ 0.95) and liveness check
3. Attendance engine records check-in or check-out (60s duplicate window)
4. Unknown faces logged as security alerts

## RFID flow

1. Admin registers an RFID reader (location + direction) and receives a one-time API token
2. Admin assigns card UIDs to employees in the UI
3. Physical reader POSTs to `POST /api/v1/rfid/tap` with `Authorization: Bearer <token>` and body `{ "uid": "A1B2C3D4" }`
4. API looks up the card and records check-in or check-out

## Edge cameras (optional)

For on-site inference, set a camera to **edge** deployment mode and run a local `backend` instance (e.g. port 8001). Sync the FAISS index with `GET /api/v1/embeddings/export` and `POST /api/v1/embeddings/import` so recognition runs without streaming video to the central server.

## Anomaly detection

1. API gathers attendance features (check-in time, overtime, recognition frequency, etc.)
2. Rule-based checks + **Isolation Forest** ML outlier detection
3. Anomalies stored in `attendance_anomalies` for HR review

## Security notes

- Use **TLS 1.3** in production (reverse proxy: nginx, Caddy, or IIS)
- Set `APP_ENV=production` and a strong `JWT_SECRET` in production
- Passwords hashed with **Argon2id**
- Rotate secrets per environment; enable PostgreSQL SSL (`DB_SSLMODE=require`)

## Non-functional requirements (NFR)

| ID | Requirement | Implementation |
|----|-------------|----------------|
| **NFR-001** | Recognition < 500 ms/face | `NFR_RECOGNITION_SLA_MS=500`; API returns `sla_met` |
| **NFR-002** | 10,000 employees | `NFR_MAX_EMPLOYEES=10000`; FAISS flat index |
| **NFR-003** | 100 cameras | `NFR_MAX_CAMERAS=100`; stream poll + heartbeat |
| **NFR-004** | 99.9% uptime | `GET /api/v1/health` and `GET /up` |
| **NFR-005** | Horizontal scaling | Stateless API; Redis in production |
| **NFR-008** | GDPR compliance | Retention purge API; privacy endpoints |

Check compliance: `GET http://127.0.0.1:8000/api/v1/health`

## Windows installer

See [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md) for the offline EXE setup (Python, PostgreSQL, Redis, nginx).

## Project structure

```
attendance/
├── backend/       # FastAPI API + face recognition
├── frontend/      # React admin UI
├── windows/       # Installer + tray launcher
└── scripts/       # Dev utilities (e.g. test-face.py)
```

## Test face recognition

```bash
python scripts/test-face.py path/to/photo.jpg
```

Requires backend on **http://127.0.0.1:8000**.
