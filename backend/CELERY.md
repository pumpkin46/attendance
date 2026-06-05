# Redis & Celery

Both are **optional and off by default** — the app runs single-process without
them. Enable them for multi-worker deployments.

## Redis

Used for **cross-worker shared state**:

- **Duplicate suppression** (`app/services/attendance_service.py`) — an atomic
  `SET key 1 NX EX <window>` so a recognition/RFID tap is de-duplicated across
  every worker, not just the one that handled the first event.
- **Rate limiting** (`app/core/rate_limit.py`) — a per-IP fixed window via
  `INCR`/`EXPIRE`, so `/auth/login` and recognition limits hold fleet-wide.
- **Realtime WebSocket fan-out** (`app/realtime/hub.py`) — `publish` does a Redis
  `PUBLISH`; every worker runs a `SUBSCRIBE` loop (started in the app lifespan)
  that delivers events to its own connected clients. Without this, a client only
  receives events produced by the worker it happens to be connected to.

Both **degrade gracefully**: if Redis is disabled or unreachable they fall back
to the in-process implementations (correctness for attendance is still
guaranteed by the `UNIQUE(employee_id, work_date)` constraint and the
timestamp-based guard).

Enable:

```bash
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
```

## Celery

Used for **periodic background jobs** (Celery Beat). Tasks live in
`app/tasks/maintenance.py` and reuse the app's async services via
`app/tasks/base.py::run_async`.

| Task | Schedule (default) | What it does |
|------|--------------------|--------------|
| `maintenance.expire_visitors` | every 60s | Expire visitors past their visit/face window; revoke temp access |
| `maintenance.detect_anomalies` | hourly | Run attendance anomaly detection across all tenants |
| `maintenance.purge_retention` | daily | Delete audit logs / recognition events / notifications past GDPR retention |

When `CELERY_ENABLED=true`, the in-process visitor-expiry loop is **not** started
(Beat owns it instead), avoiding double execution.

Enable & run:

```bash
CELERY_ENABLED=true            # in .env (so the API skips its in-process loop)

# Worker (executes tasks):
celery -A app.celery_app.celery_app worker --loglevel=info

# Beat (schedules periodic tasks):
celery -A app.celery_app.celery_app beat --loglevel=info
```

Broker and result backend default to `REDIS_URL`; override with
`CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` (e.g. separate Redis DBs).

Intervals are configurable: `BEAT_VISITOR_EXPIRY_SECONDS`,
`BEAT_ANOMALY_DETECTION_SECONDS`, `BEAT_RETENTION_PURGE_SECONDS`.
