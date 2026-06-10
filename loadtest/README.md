# Load-test harness

k6 scripts that measure the platform against its performance NFRs and produce a
clear **pass/fail** (k6 exits non-zero if any threshold is breached). Pair this with
[`docs/NFR_GAP_ANALYSIS.md`](../docs/NFR_GAP_ANALYSIS.md).

| Script | Validates | Threshold |
|---|---|---|
| [`k6/api-slo.js`](k6/api-slo.js) | API response time | p95 < 200 ms per read endpoint |
| | Dashboard refresh | p95 < 1000 ms |
| | Error rate | < 1 % |
| [`k6/recognition.js`](k6/recognition.js) | Recognition latency | p95 < 300 ms (request **and** engine `processing_ms`) |

> Attendance-write (< 100 ms) isn't a standalone GET; it happens inside
> `/recognition/identify` and `/attendance/manual`. The recognition script's
> `processing_ms` covers the write path during identify; add a manual-entry scenario
> if you need to isolate it.

## Why k6
Single static binary (no Python env to manage), and `thresholds` map 1:1 to the NFRs,
so the run is self-grading. Locust is a fine Python alternative if you prefer it.

## Install k6
- **Windows:** `choco install k6` (or `winget install k6` where winget is available — note Windows Server lacks it)
- **macOS:** `brew install k6`
- **Linux / offline:** download the binary from the k6 releases page
- Verify: `k6 version`

## Prerequisites
1. The backend running and reachable (default `http://127.0.0.1:8000`).
2. Valid credentials. Pass them as env vars — **never hard-code**.
3. **Seed representative data first.** Empty tables make every query trivially fast and the
   numbers meaningless. Load test against ~the target row counts (employees, attendance,
   events) to get a real p95. Use the bundled seeder:

   ```bash
   cd backend
   python seed.py            # base org + admin user (once)
   python seed_loadtest.py   # bulk volume: employees, attendance, cameras, audit, notifications, recognition
   ```

   Defaults: 1,000 employees, 90 days of attendance, 100 cameras, 20k audit logs, 500
   notifications (for `admin@attendance.local`), 2k recognition events. Tune via env vars
   (`LOADTEST_EMPLOYEES`, `LOADTEST_ATTENDANCE_DAYS`, `LOADTEST_CAMERAS`, `LOADTEST_AUDIT_LOGS`,
   `LOADTEST_NOTIFICATIONS`, `LOADTEST_RECOGNITION`). It's idempotent — rerun with
   `LOADTEST_RESET=1` to rebuild. See [`backend/seed_loadtest.py`](../backend/seed_loadtest.py).
4. For recognition: a face image. A bundled one (`assets/face.jpg`) is used by default;
   override with `IMAGE_PATH` if you want your own.

## Run

```bash
# API SLO test (read endpoints + dashboard)
k6 run -e BASE_URL=http://127.0.0.1:8000 -e EMAIL=admin@attendance.local -e PASSWORD='***' \
       -e VUS=20 -e DURATION=1m loadtest/k6/api-slo.js

# Recognition latency test (uses bundled assets/face.jpg by default)
k6 run -e PASSWORD='***' -e VUS=5 -e DURATION=30s loadtest/k6/recognition.js
# To use your own image, pass an absolute path (relative paths resolve from
# the script dir, loadtest/k6/, not your CWD):
#   k6 run -e PASSWORD='***' -e IMAGE_PATH=C:\path\to\face.jpg loadtest/k6/recognition.js
```

### Env vars
| Var | Default | Notes |
|---|---|---|
| `BASE_URL` | `http://127.0.0.1:8000` | API origin (no trailing slash) |
| `EMAIL` | `admin@attendance.local` | Login user |
| `PASSWORD` | — | **Required** |
| `VUS` | 20 (api) / 1 (recog) | Concurrent virtual users. Keep recog at 1 on CPU-only hosts — see [Recognition concurrency](#recognition-concurrency-vs-cpu-cores) |
| `DURATION` | `1m` / `30s` | Steady-state duration |
| `IMAGE_PATH` | `../assets/face.jpg` | Face image for `recognition.js`; relative paths resolve from the script dir, not CWD |

## Rate limiting (important)
The server rate-limits `login` (10/min) and `recognition` (60/min) per key
(`backend/app/core/config.py`). For meaningful recognition throughput, disable it on the
**test** server only:

```bash
RATE_LIMIT_ENABLED=false   # backend env, test environment only
```

The scripts already log in **once** (in `setup()`) and reuse the token, so the login limit
isn't a problem. A `429` shows up as a failed `not rate-limited` check.

## Recognition concurrency vs. CPU cores
Recognition is **CPU-bound inference** (each `identify` call can itself be multi-threaded),
unlike the I/O-bound read endpoints in `api-slo.js`. On a host without a GPU, run it at
**`VUS=1`** (the default). Pushing more virtual users than you have spare cores doesn't
measure the engine — it measures queueing: requests pile up behind each other and the
latency tail explodes (we've seen p95 swing from ~0.7s to ~20s purely on concurrency).

- **CPU-only:** keep `VUS=1`. The median/p95 you get is the engine's true per-request time.
- **GPU host (or many spare cores):** raise `VUS` to probe real throughput.
- A run-to-run p95 that swings wildly while the **median stays flat** is the tell-tale sign of
  oversubscription, not a slow engine — drop `VUS` and re-measure.

The read endpoints (`api-slo.js`) are I/O-bound and tolerate much higher `VUS`; this caveat
is specific to recognition.

## Interpreting results
- k6 prints a per-metric table and **exits non-zero if any threshold fails** — good for CI.
- `http_req_duration{endpoint:...}` is end-to-end (network + server). Run k6 close to the
  server to isolate server time.
- `server_processing_ms` is the engine's self-reported recognition time, independent of network.
- Watch `http_req_failed` and the `checks` rate — threshold passes are meaningless if requests
  are erroring or being rate-limited.

## Scope & caveats
- This measures **single-node** latency under modest concurrency — the achievable NFRs in the
  gap analysis. It does **not** prove the 5,000-camera / 10,000-concurrent / 99.99 % targets;
  those need GPU + horizontal scale + an HA topology first (see the gap-analysis roadmap).
- Start small (`VUS=10`) and ramp up; find the concurrency where p95 crosses each SLO — that
  number is your current single-node ceiling.
- CI idea: run `api-slo.js` against a seeded staging DB on each release and gate on the exit code.

## Finding the single-node ceiling
[`find-ceiling.ps1`](find-ceiling.ps1) sweeps VUS levels and reports the highest one that
still holds every SLO (k6 exits non-zero on any breach, so each level is a clean PASS/FAIL):

```powershell
cd loadtest
.\find-ceiling.ps1 -Password '***'                       # default levels 1,2,3,5,8,12,20
.\find-ceiling.ps1 -Password '***' -Levels 1,2,3 -Duration 30s
```

The ceiling is highly dependent on the Postgres instance, not just the app. The list
endpoints were tuned to avoid wasted work — flat-DTO endpoints (employees/attendance/audit)
suppress the model's `lazy="selectin"` relationship loads, and `/attendance` honors
`date_from`/`date_to` so it scans the requested window instead of the whole table. The next
limiter under load is typically the **cameras** list and the **dashboard** aggregation
(both good Redis-cache candidates). If you need a higher ceiling, cache those or tune/scale
Postgres before adding more app logic.
