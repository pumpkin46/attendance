# AI Service — Face recognition only

This service does **not** implement attendance (check-in/out, shifts, overtime, reports). That is intentional.

## Responsibility

| Service | Role |
|---------|------|
| **ai-service** (this) | Face detect, embed, FAISS search, anti-spoof liveness |
| **backend** (Laravel) | Attendance engine, employees, cameras, audit, reports |
| **frontend** | Admin UI |

## API endpoints (port 8001)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Service status |
| POST | `/api/v1/enroll` | Store face embedding for `employee_id` |
| POST | `/api/v1/identify` | Match face → returns `employee_id` + confidence |
| POST | `/api/v1/delete` | Remove embeddings for employee |
| GET | `/api/v1/embeddings/export` | Export FAISS index for edge sync |
| POST | `/api/v1/embeddings/import` | Import index on edge device |
| POST | `/api/v1/embeddings/reload` | Reload index from disk |
| POST | `/api/v1/anomalies/analyze` | Detect attendance anomalies (rules + ML) |

## How attendance works

```
Camera / kiosk image
        ↓
POST /api/v1/recognition/identify   ← Laravel backend (port 8000)
        ↓
    calls ai-service /identify
        ↓
AttendanceService → check-in / check-out in PostgreSQL
```

**For attendance you must call the Laravel API**, not ai-service alone.

Example (after login):

```http
POST http://127.0.0.1:8000/api/v1/recognition/identify
Authorization: Bearer {token}
{ "image": "data:image/jpeg;base64,...", "camera_id": 1 }
```

Or use `python scripts/test-face.py your-photo.jpg` from the project root.

## Anti-spoof liveness

Three layers prevent print/screen buddy punching:

1. **Face quality** — exactly one face, InsightFace detection score ≥ threshold  
2. **MiniFASNetV2 ONNX** — classifies live vs spoof (photo/screen)  
3. **Heuristics** — blur, moiré (screen replay), saturation on face crop  

Download the model once:

```bash
cd ai-service
python scripts/download_antispoof_model.py
```

Check `/health` → `antispoof_model_loaded: true`.

Configure in `.env` (see `.env.example`):

- `ANTISPOOF_ENABLED=true`
- `ANTISPOOF_BLOCK_ENROLLMENT=true` — blocks enrolling from a printed photo
- `ANTISPOOF_REAL_THRESHOLD=0.5` — minimum “live” probability
