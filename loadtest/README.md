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
- **Windows:** `winget install k6` or `choco install k6`
- **macOS:** `brew install k6`
- **Linux / offline:** download the binary from the k6 releases page
- Verify: `k6 version`

## Prerequisites
1. The backend running and reachable (default `http://127.0.0.1:8000`).
2. Valid credentials. Pass them as env vars — **never hard-code**.
3. **Seed representative data first.** Empty tables make every query trivially fast and the
   numbers meaningless. Load test against ~the target row counts (employees, attendance,
   events) to get a real p95.
4. For recognition: a JPEG/PNG containing a face, referenced by `IMAGE_PATH`.

## Run

```bash
# API SLO test (read endpoints + dashboard)
k6 run -e BASE_URL=http://127.0.0.1:8000 -e EMAIL=admin@attendance.local -e PASSWORD='***' \
       -e VUS=20 -e DURATION=1m loadtest/k6/api-slo.js

# Recognition latency test (needs a face image)
k6 run -e PASSWORD='***' -e IMAGE_PATH=./loadtest/assets/face.jpg \
       -e VUS=5 -e DURATION=30s loadtest/k6/recognition.js
```

### Env vars
| Var | Default | Notes |
|---|---|---|
| `BASE_URL` | `http://127.0.0.1:8000` | API origin (no trailing slash) |
| `EMAIL` | `admin@attendance.local` | Login user |
| `PASSWORD` | — | **Required** |
| `VUS` | 20 (api) / 5 (recog) | Concurrent virtual users |
| `DURATION` | `1m` / `30s` | Steady-state duration |
| `IMAGE_PATH` | — | Required for `recognition.js`; path to a face image |

## Rate limiting (important)
The server rate-limits `login` (10/min) and `recognition` (60/min) per key
(`backend/app/core/config.py`). For meaningful recognition throughput, disable it on the
**test** server only:

```bash
RATE_LIMIT_ENABLED=false   # backend env, test environment only
```

The scripts already log in **once** (in `setup()`) and reuse the token, so the login limit
isn't a problem. A `429` shows up as a failed `not rate-limited` check.

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
