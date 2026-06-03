# Backend — API + face recognition

Unified **FastAPI** application: business API (attendance, employees, RFID, reports, …) and **face recognition** (detect, embed, FAISS, anti-spoof) in one process.

Default port: **8000**

## Stack

| Area | Technology |
|------|------------|
| API | FastAPI, Pydantic, JWT auth |
| Database | PostgreSQL (SQLAlchemy async + Alembic) |
| Cache / queues | Redis (optional) |
| Face AI | InsightFace, OpenCV, FAISS, MiniFASNetV2 ONNX |

## Quick start

```bash
cd backend
cp .env.example .env
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
alembic upgrade head
python seed.py
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health: `GET http://127.0.0.1:8000/health` · API health: `GET /api/v1/health`

## API surface

### Business API (`/api/v1/...`)

Auth, employees, attendance, shifts, cameras, RFID, visitors, access control, reports, audit, privacy, smart building, security monitoring, edge devices, and more — see route modules under `app/api/`.

### Face recognition (`/api/v1/...`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/enroll` | Store face embedding for `employee_id` |
| POST | `/api/v1/recognize` | Full pipeline + per-stage timings + SLA flags |
| POST | `/api/v1/recognize-stream` | RTSP/IP/NVR frame capture → recognize |
| POST | `/api/v1/identify` | Match face → `employee_id` + confidence |
| POST | `/api/v1/delete` | Remove embeddings for employee |
| GET | `/api/v1/embeddings/export` | Export FAISS index for edge sync |
| POST | `/api/v1/embeddings/import` | Import index on edge device |
| POST | `/api/v1/embeddings/reload` | Reload index from disk |
| POST | `/api/v1/anomalies/analyze` | Attendance anomaly analysis (rules + ML) |

### Attendance via recognition

```http
POST http://127.0.0.1:8000/api/v1/recognition/identify
Authorization: Bearer {token}
{ "image": "data:image/jpeg;base64,...", "camera_id": 1 }
```

Or from repo root: `python scripts/test-face.py your-photo.jpg`

## Recognition pipeline

```
Video Stream → Face Detection → Face Tracking → Face Quality Check
    → Liveness Detection → Embedding Generation → Vector Search → Identity Match
    → AttendanceService (check-in / check-out)
```

## Anti-spoof liveness

1. **Face quality** — one face, detection score ≥ threshold  
2. **MiniFASNetV2 ONNX** — live vs spoof  
3. **Heuristics** — blur, moiré, saturation on face crop  

```bash
python scripts/download_antispoof_model.py
```

Configure in `.env` (see `.env.example`): `ANTISPOOF_ENABLED`, `ANTISPOOF_BLOCK_ENROLLMENT`, `ANTISPOOF_REAL_THRESHOLD`.

## Edge cameras

Cameras in **edge** deployment mode use a local `backend` instance (often port 8001). Use the embedding export/import APIs to keep the on-site FAISS index in sync with the central server.
