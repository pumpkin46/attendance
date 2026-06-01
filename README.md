# AI Attendance Platform

Enterprise-grade attendance system with face recognition, liveness detection, RBAC, multi-location support, and automated check-in/out. Runs locally without Docker.

## Architecture

```
Web UI (React)  →  API (Laravel)  →  AI Service (FastAPI)
                         ↓
              PostgreSQL + Redis
```

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

> InsightFace downloads models on first run. Without GPU/models, a deterministic mock embedding mode is used for development.

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
| Attendance Engine | Check-in/out, duplicate prevention, overtime |
| Shift Management | Schedules, grace periods, assignments |
| Reporting | Summary, overtime, CSV export |
| Camera Management | Multi-camera, heartbeat monitoring |
| Audit Logs | All sensitive actions logged |

## Recognition flow

1. Camera or kiosk sends base64 image to `POST /api/v1/recognition/identify`
2. Laravel forwards to AI service for embedding match (threshold ≥ 0.95)
3. Liveness check must pass
4. Attendance engine records check-in or check-out (60s duplicate window)
5. Unknown faces logged as alerts

## Security notes

- Use **TLS 1.3** in production (reverse proxy: nginx, Caddy, or IIS)
- Set `APP_DEBUG=false` in production
- Configure OAuth providers in `.env` for SSO (Google, Microsoft via Socialite)
- Rotate `APP_KEY` per environment; enable PostgreSQL SSL (`DB_SSLMODE=require`)

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
└── README.md
```
