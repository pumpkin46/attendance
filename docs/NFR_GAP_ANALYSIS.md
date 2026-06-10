# Non-Functional Requirements — Gap Analysis

**Date:** 2026-06-09
**Scope:** Assessment of the Attendance Platform against the target non-functional
requirements (NFRs) for availability, scalability, and performance.
**Verdict in one line:** The requested figures are **10–50× larger** than what the
system was designed and documented for; the per-request latency targets are
*plausible at small scale but unvalidated*, while the scale and availability
targets are **not met** by the current single-node, CPU-only design.

> Nothing here has been measured yet — there were no load tests or benchmarks in
> the repo. A load-test harness now lives in [`/loadtest`](../loadtest/README.md)
> to turn the "plausible" rows below into measured pass/fail.

---

## 1. Summary

| NFR | Target (requested) | Designed-for (repo `README` NFR table) | Current implementation | Verdict |
|---|---|---|---|---|
| Availability | 99.99 % (~52 min/yr) | 99.9 % (~8.7 h/yr) | Single offline Windows node, no HA/replication/failover | ❌ Not met |
| Employees | 100,000 | 10,000 (`NFR_MAX_EMPLOYEES`) | Postgres + FAISS **flat** index (in-memory, single node) | ⚠️ Storage OK; recognition throughput is the limit |
| Cameras | 5,000 | 100 (`NFR_MAX_CAMERAS`) | `asyncio` task per stream in **one** process | ❌ Not met |
| Simultaneous recognitions | 10,000 | *unspecified* | **CPU-only** inference, single node | ❌ Not met |
| Recognition latency | < 300 ms | < 500 ms (`NFR_RECOGNITION_SLA_MS`) | CPU `buffalo_l`, det 640×640 | ⚠️ Borderline single-shot; fails under concurrency |
| Attendance write | < 100 ms | — | One async INSERT (Postgres) | ✅ Plausible (unvalidated) |
| Dashboard refresh | < 1 s | — | WebSocket push + 60 s poll fallback | ✅ Plausible at small scale (unvalidated) |
| API response | < 200 ms | — | Async FastAPI + asyncpg + pagination | ✅ Plausible at small scale (unvalidated) |

Legend: ✅ likely met · ⚠️ conditional / borderline · ❌ structurally not met.

---

## 2. Architecture snapshot (evidence)

| Concern | What the code does | Reference |
|---|---|---|
| Web API | FastAPI (async) on a **single** uvicorn process (no `--workers`) | `backend/run.ps1` |
| Database | PostgreSQL via async `asyncpg`, pool `size=10, max_overflow=20` (≈30 conns) | `backend/app/core/database.py`, `backend/app/core/config.py:45` |
| Face models | InsightFace `buffalo_l` on **`CPUExecutionProvider`** (no GPU/CUDA) | `backend/app/engine/face_detector.py:93`, `backend/app/services/face_service.py:34` |
| Anti-spoof | ONNX model, also `CPUExecutionProvider` | `backend/app/services/antispoof.py:67` |
| Vector search | FAISS `IndexFlatIP` (exact brute-force), 512-d, in-memory, single node | `backend/app/services/faiss_index.py:29` |
| Camera streams | One `asyncio.create_task` loop per camera in the API process | `backend/app/engine/stream_manager.py:194` |
| Background jobs | Celery + Redis (present, used for async tasks) | `backend/requirements.txt` |
| Realtime | WebSocket hub + client poll fallback (60 s) | `backend/app/realtime/hub.py`, frontend `useFallbackPoll` |
| Recognition SLA | Self-defined budget **500 ms**, surfaced via `/recognition/config` | `backend/app/api/recognition.py:39` |
| Packaging | Single **offline Windows PC**: uvicorn + Postgres + Redis + Celery + nginx | `WINDOWS_INSTALL.md`, `README.md` |
| Rate limits | login 10/60 s, recognition 60/60 s (per key) | `backend/app/core/config.py:97-100` |

---

## 3. Per-requirement analysis

### 3.1 Availability — 99.99 %
- **Target:** ≤ ~52 minutes of downtime per year.
- **Current:** Everything runs as a single instance on one Windows box (uvicorn, Postgres,
  Redis, Celery, nginx). No clustering, no DB replication, no load balancer, no failover.
  Models load lazily on first use, so a restart adds cold-start latency too.
- **Verdict:** ❌ Structurally impossible. A single node cannot hit 99.99 %; one reboot,
  crash, deploy, or hardware blip exhausts the annual budget. The API *is* stateless with
  Redis (README NFR-005), so the building block for HA exists, but no HA topology is shipped.
- **Gap:** Multi-node deployment behind a load balancer; Postgres HA (primary + replica,
  automatic failover); Redis HA; health-checked rolling deploys; infra monitoring/alerting;
  an availability SLO + error budget.

### 3.2 Scalability — 100,000 employees
- **Target:** 100k enrolled identities.
- **Current:** Postgres stores 100k employees trivially. FAISS `IndexFlatIP` holds the
  embeddings in memory (~100k × 512 × 4 B ≈ **200 MB** per embedding set) and a single
  query is still fast. **But** the index is *flat* (linear scan), in-memory, and single-node,
  and the documented ceiling is 10k.
- **Verdict:** ⚠️ Data capacity is fine; the constraint is recognition **throughput**, not
  storage (see 3.4/3.5).
- **Gap:** Replace flat index with an ANN index (FAISS IVF/HNSW) or a vector DB; shard/replicate
  it; load-test enrollment + match latency at 100k vectors.

### 3.3 Scalability — 5,000 cameras
- **Target:** 5,000 concurrent camera streams.
- **Current:** Each camera is an in-process `asyncio` loop in the single API process. Workable
  for ~100 cameras (the documented target); 5,000 simultaneous RTSP decodes plus CPU inference
  on one node is not feasible.
- **Verdict:** ❌ Not met.
- **Gap:** Move stream ingest/inference to a horizontally-scaled **edge/worker fleet**
  (ideally GPU), decoupled from the API; partition cameras across nodes; backpressure + a queue.

### 3.4 Scalability — 10,000 simultaneous recognitions
- **Target:** 10k concurrent recognitions.
- **Current:** Detection + embedding run on **CPU** (`buffalo_l`, 640×640). Per-face CPU cost is
  ~150–400 ms on typical hardware, and `identify` runs in a threadpool off the single event loop.
  Ten thousand concurrent recognitions on one CPU node is physically impossible.
- **Verdict:** ❌ Not met.
- **Gap:** GPU inference (`CUDAExecutionProvider`/TensorRT) + a horizontally-scaled worker pool
  fed by a queue (Celery/Redis already present), with autoscaling and batching.

### 3.5 Performance — recognition < 300 ms
- **Target:** < 300 ms/face.
- **Current:** The code's own budget is **500 ms**, not 300. On CPU, a single recognition is
  often 150–400 ms (hardware-dependent); FAISS search adds little. So < 300 ms is *achievable
  for one request on a fast CPU* but not guaranteed, and degrades sharply under concurrency.
- **Verdict:** ⚠️ Borderline single-shot; unvalidated; fails concurrent.
- **Gap:** GPU brings this to tens of ms and holds under load; measure with
  [`loadtest/k6/recognition.js`](../loadtest/k6/recognition.js).

### 3.6 Performance — attendance write < 100 ms
- **Target:** < 100 ms.
- **Current:** A single async INSERT to Postgres. Comfortably sub-100 ms locally.
- **Verdict:** ✅ Plausible — but unvalidated under load (connection-pool contention at high
  concurrency is the risk).

### 3.7 Performance — dashboard refresh < 1 s
- **Target:** < 1 s.
- **Current:** WebSocket push with a 60 s poll fallback; dashboard queries are aggregated and
  paginated. Fine for moderate data; at 100k-employee scale the aggregates need indexes/caching.
- **Verdict:** ✅ Plausible at small scale; unvalidated at target scale.

### 3.8 Performance — API response < 200 ms
- **Target:** < 200 ms.
- **Current:** Async FastAPI + asyncpg + pagination → typical CRUD is well under 200 ms locally.
  Single uvicorn worker + ~30 DB connections will be the ceiling under heavy concurrency.
- **Verdict:** ✅ Plausible at small scale; validate with [`loadtest/k6/api-slo.js`](../loadtest/k6/api-slo.js).

---

## 4. Root-cause themes

1. **CPU-only inference** — the single biggest blocker for recognition latency *and* the
   5k-camera / 10k-concurrent scale targets.
2. **Single-node deployment** — caps availability (no HA) and throughput (no horizontal scale),
   even though the API is stateless and could scale out.
3. **Flat, in-memory FAISS index** — fine at the 10k design point, not a 100k+ multi-node story.
4. **No performance validation** — no load tests/benchmarks existed, so even the achievable
   targets were assumptions. (Addressed by the new harness.)
5. **Scope mismatch** — the build targets 10k employees / 100 cameras / 99.9 %; the request is
   100k / 5,000 / 99.99 %. This is a re-architecture, not tuning.

---

## 5. Remediation roadmap

**Phase 0 — Validate (now).** Run the [`/loadtest`](../loadtest/README.md) harness against a
representative dataset; record p95/p99 for each endpoint and recognition; confirm which "plausible"
rows actually pass. Add the run to CI as a regression gate.

**Phase 1 — Single-node performance.** Add DB indexes for dashboard aggregates; cache hot
dashboard reads in Redis; run uvicorn with multiple workers behind nginx; tune the DB pool +
add PgBouncer. Re-measure the four latency NFRs.

**Phase 2 — Recognition scale.** GPU inference (CUDA/TensorRT); a recognition queue with a
worker pool (Celery/Redis) and batching; swap FAISS flat → IVF/HNSW (or a vector DB).

**Phase 3 — Horizontal + HA.** Multiple stateless API nodes behind a load balancer; Postgres
primary/replica with automatic failover; Redis HA; an edge/worker fleet for the 5,000 cameras;
autoscaling. This is what unlocks 99.99 % and the 10k-concurrent / 5k-camera targets.

**Phase 4 — Continuous validation.** Soak/stress tests at target scale; SLOs + error budgets;
infra dashboards and alerting.

---

## 6. Assumptions & caveats
- Latency estimates for CPU inference are hardware-dependent (`buffalo_l` @ 640×640); treat them
  as order-of-magnitude until the harness measures the actual deployment.
- "Single node" reflects the shipped offline-Windows package; the codebase can run multi-node, so
  Phase 1–3 are deployment/infra work plus the GPU + ANN changes, not a rewrite of business logic.
