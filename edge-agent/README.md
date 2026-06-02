# Edge AI Camera Agent

Runs face recognition **on-site** at each camera location. Frames never leave the device — only match results are sent to the central API.

## Architecture

```
IP Camera (RTSP) → edge-agent → local ai-service (InsightFace + FAISS)
                      ↓
              Laravel API (attendance only)
```

| Component | Location | Role |
|-----------|----------|------|
| **edge-agent** | Edge device | Capture, sync embeddings, local identify, report |
| **ai-service** | Edge device | Face detect, embed, FAISS match, liveness |
| **backend** | Central server | Attendance, device registry, embedding export |

## Setup

### 1. Register edge device (admin UI)

Go to **Edge AI** → **Deploy device**. Link to a camera, set the local stream URL, and save the one-time API token.

Set the linked camera's deployment mode to **edge** (automatic when linked).

### 2. Install local AI service on the edge device

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001
```

### 3. Install and run edge agent

```bash
cd edge-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with BACKEND_URL, EDGE_DEVICE_TOKEN, STREAM_URL
python agent.py
```

## Device API (used by agent)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/edge/config` | Bearer device token |
| GET | `/api/v1/edge/embeddings` | Bearer device token |
| POST | `/api/v1/edge/sync-ack` | Bearer device token |
| POST | `/api/v1/edge/heartbeat` | Bearer device token |
| POST | `/api/v1/edge/report` | Bearer device token |

## Hardware targets

- NVIDIA Jetson (recommended for production)
- Intel NUC / mini PC
- Raspberry Pi 4+ (CPU-only, use mock mode or lighter models)

## Cloud vs edge

| Mode | Where AI runs | Stream handling |
|------|---------------|-----------------|
| **cloud** | Central ai-service | `php artisan cameras:poll-streams` |
| **edge** | Local ai-service | edge-agent on device |
