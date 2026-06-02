# AI Attendance Platform

Enterprise-grade attendance system with face recognition, liveness detection, RBAC, multi-location support, and automated check-in/out. Runs locally without Docker.

## Architecture

```
Web UI (React)  →  API (Laravel)  →  AI Service (FastAPI)
                         ↓                    ↓
              PostgreSQL              enroll / identify only
              Attendance engine       (no attendance here)
```

**Attendance (check-in/out) is only in the Laravel backend.** The AI service returns `employee_id` + confidence; Laravel writes attendance records.

| Layer | Stack |
|-------|--------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Laravel 11, Sanctum, PostgreSQL, Redis |
| AI | FastAPI, InsightFace, OpenCV, FAISS |

## Prerequisites

- **PHP 8.2+** with extensions: `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `json`, `bcmath`
- **Composer 2**
- **PostgreSQL 14+**
- **Redis 6+**
- **Node.js 20+**
- **Python 3.10+**

## 1. Database

```bash
createdb attendance
```

## 2. Backend (Laravel API)

```bash
cd backend
cp .env.example .env
composer install
php artisan key:generate
```

Edit `.env` with PostgreSQL and Redis credentials, then:

```bash
php artisan migrate --seed
php artisan serve
```

API runs at **http://127.0.0.1:8000**

Default admin: `admin@attendance.local` / `password`

## 3. AI Service

```bash
cd ai-service
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

AI service runs at **http://127.0.0.1:8001**

Set `AI_SERVICE_URL=http://127.0.0.1:8001` in backend `.env`.

> Uses **InsightFace 1.0**, **FAISS 1.14**, **FastAPI 0.136**, **ONNX Runtime 1.23**. Models (`buffalo_l`) download on first run. Without models, a deterministic mock embedding mode is used for development.

## 4. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

UI runs at **http://127.0.0.1:5173**

## Core modules

| Module | Description |
|--------|-------------|
| Authentication & RBAC | Sanctum tokens, roles, permissions, OAuth-ready |
| Employee Management | CRUD, departments, locations |
| Face Enrollment | Upload photo → AI embedding → FAISS index |
| Face Recognition | Identify + liveness → auto attendance |
| RFID Integration | Card tap at readers → auto check-in/out |
| Attendance Engine | Check-in/out, duplicate prevention, overtime |
| Anomaly Detection | AI rules + Isolation Forest on attendance patterns |
| Shift Management | Schedules, grace periods, assignments |
| Reporting | Summary, overtime, CSV export |
| Camera Management | Multi-camera, heartbeat monitoring |
| Edge AI Deployment | On-device inference via edge-agent |
| Audit Logs | All sensitive actions logged |

## Recognition flow

1. Camera or kiosk sends base64 image to `POST /api/v1/recognition/identify`
2. Laravel forwards to AI service for embedding match (threshold ≥ 0.95)
3. Liveness check must pass
4. Attendance engine records check-in or check-out (60s duplicate window)
5. Unknown faces logged as alerts

## RFID flow

1. Admin registers an RFID reader (location + direction) and receives a one-time API token
2. Admin assigns card UIDs to employees in the UI
3. Physical reader POSTs to `POST /api/v1/rfid/tap` with `Authorization: Bearer <token>` and body `{ "uid": "A1B2C3D4" }`
4. Laravel looks up the card, records check-in or check-out (60s duplicate window by default)
5. Unknown or inactive cards are logged in `rfid_events`

## Edge AI deployment

Run face recognition **on the camera site** (Jetson, NUC, etc.) instead of streaming video to central AI.

```
IP Camera → edge-agent → local ai-service → Laravel API (match results only)
```

1. Admin deploys an edge device in **Edge AI** UI and links it to a camera
2. Install `ai-service` + `edge-agent` on the edge hardware (see `edge-agent/README.md`)
3. Agent syncs FAISS embeddings from central server and runs local identify
4. Only match results are POSTed to `/api/v1/edge/report` — no images leave the device
5. Cloud-mode cameras continue using `php artisan cameras:poll-streams`

## Anomaly detection

AI-powered scan for suspicious attendance patterns:

1. Laravel gathers attendance features (check-in time, overtime, recognition frequency, etc.)
2. AI service applies **rule-based checks** + **Isolation Forest** ML outlier detection
3. Anomalies stored in `attendance_anomalies` for HR review

```bash
php artisan attendance:detect-anomalies --days=30
```

Detected types: missing check-out, excessive overtime, unusual check-in time, weekend work, short work day, high recheck frequency, statistical outliers, absence patterns.

## Security notes

- Use **TLS 1.3** in production (reverse proxy: nginx, Caddy, or IIS); set `FORCE_HTTPS=true`
- Set `APP_DEBUG=false` and `APP_ENV=production` in production
- **NFR-007**: Passwords hashed with **Argon2id** (`HASH_DRIVER=argon2id`, requires PHP `ext-sodium`)
- **NFR-006**: Laravel encrypts data at rest with **AES-256-CBC** (`APP_KEY`)
- Configure OAuth providers in `.env` for SSO (Google, Microsoft via Socialite)
- Rotate `APP_KEY` per environment; enable PostgreSQL SSL (`DB_SSLMODE=require`)

## Non-functional requirements (NFR)

| ID | Requirement | Implementation |
|----|-------------|----------------|
| **NFR-001** | Recognition < 500 ms/face | `NFR_RECOGNITION_SLA_MS=500`; AI `max_processing_ms=500`; API returns `sla_met` |
| **NFR-002** | 10,000 employees | `NFR_MAX_EMPLOYEES=10000`; FAISS flat index; capacity enforced on create |
| **NFR-003** | 100 cameras | `NFR_MAX_CAMERAS=100`; stream poll + heartbeat monitoring |
| **NFR-004** | 99.9% uptime | `GET /api/v1/health` + Laravel `/up`; component health checks |
| **NFR-005** | Horizontal scaling | `AI_SERVICE_URLS` round-robin; stateless API; Redis queues in production |
| **NFR-006** | TLS 1.3 + AES-256 | HTTPS middleware; Laravel `APP_KEY` encryption |
| **NFR-007** | Argon2 passwords | `config/hashing.php` → `argon2id` |
| **NFR-008** | GDPR compliance | Retention purge (`php artisan privacy:purge-retention`); privacy API |

Check compliance: `GET http://127.0.0.1:8000/api/v1/health`

### Production scaling (NFR-005)

```
                    ┌─────────────┐
   Load balancer ──►│ API servers │ (stateless, Sanctum tokens)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        PostgreSQL    Redis queue   AI nodes (FAISS on shared storage)
```

Set in `.env`:
```env
AI_SERVICE_URLS=http://ai1:8001,http://ai2:8001
QUEUE_CONNECTION=redis
CACHE_STORE=redis
```

## Acceptance criteria

| Criterion | Implementation |
|-----------|----------------|
| Face recognition ≥ 95% | `AI_RECOGNITION_THRESHOLD=0.95` (configurable) |
| Attendance automation | `AttendanceService` on successful match |
| Reports functional | `/reports/*` endpoints + UI |
| Audit logging | `AuditService` on auth, CRUD, attendance events |

## Project structure

```
attendance/
├── backend/       # Laravel API
├── frontend/      # React admin UI
├── ai-service/    # FastAPI face recognition
├── edge-agent/    # On-site camera agent
└── README.md
```
