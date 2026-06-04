# Code Review — AI Attendance Platform

**Review date:** 2026-06-04
**Reviewer:** automated static review (Claude)
**Scope:** `backend/` (FastAPI, ~21.9k LOC Python) + `frontend/` (React 19 + TS, ~6.7k LOC)
**Commit:** `2f50f94` (branch `main`)

> ⚠️ The existing `REVIEW.md` is **stale** — it describes a Laravel/PHP + separate FastAPI-AI-service
> architecture that no longer matches the code. The backend is now a **single unified FastAPI process**
> (REST API + attendance engine + face recognition) on port **8000**. This document supersedes it for
> anything security- or architecture-related. Recommend deleting or archiving `REVIEW.md`.

---

## Executive summary

The platform is feature-rich and generally well-structured: a clean service/dependency layer, consistent
RBAC via FastAPI dependencies, Argon2id hashing with bcrypt migration, multi-tenant scoping helpers, audit
logging, and a sizeable face-recognition engine with liveness/anti-spoof. Engine code has real unit tests
(17 test files).

However, the **architectural merge of the AI service into the public API process introduced a serious
authentication gap**: the entire legacy AI router is mounted unauthenticated on the same public port as the
business API. Combined with insecure defaults (`secret_key`, `app_debug`, wildcard CORS) and a few
tenant-isolation holes, there is meaningful work required before this is production-safe.

| Area | Rating | Notes |
|------|--------|-------|
| Architecture & layering | Good | Single-writer attendance, service layer, DI-based auth |
| Authentication & authz | ⚠️ Mixed | RBAC solid on business API; **AI router fully unauthenticated** |
| Tenant isolation | ⚠️ Mixed | Helper exists but applied inconsistently; a few endpoints leak |
| Secure defaults | ⚠️ Weak | Default JWT secret, debug on, CORS `*` + credentials |
| Test coverage | Mixed | Good engine unit tests; no API/integration tests, no frontend tests |
| CI/CD | Missing | No `.github/workflows` |
| Code quality | Good | No TODO/FIXME debt; consistent style; some broad `except` |

**Top 3 fixes before any internet-facing deployment:**
1. Authenticate (or remove) the legacy AI router in [`app/api/routes.py`](backend/app/api/routes.py).
2. Fail-closed on `secret_key` / `app_debug` / CORS in production.
3. Close the tenant-isolation gaps in RFID-card and upload-serving endpoints.

---

## 🔴 Critical / High severity

> **Update 2026-06-04:** All three High-severity items below have been **fixed** (see status notes). Verified:
> `pytest` 161 passed; legacy AI endpoints now return `401` when unauthenticated; production config fails closed
> on a default secret or wildcard CORS.

### H-1 — Entire AI recognition router is unauthenticated and public
**✅ Fixed.** Every route in [`routes.py`](backend/app/api/routes.py) now carries an auth dependency —
`employees.manage` for enroll/delete (biometric mutation), `recognition.manage` for embedding export/import/reload,
`cameras.manage` for stream capture, and authenticated-user for recognition reads.
[`app/api/routes.py`](backend/app/api/routes.py) mounts `/api/v1/enroll`, `/identify`, `/recognize`,
`/detect`, `/delete`, and the embedding sync endpoints with **no `Depends` on any auth/permission**. It is
included in [`main.py:64`](backend/main.py#L64) on the same FastAPI app as the business API — i.e. exposed on
the public port 8000.

Concretely, an unauthenticated caller can:
- `GET /api/v1/embeddings/export` → **exfiltrate every employee's face embedding** (biometric data — GDPR
  special-category) via [`routes.py:128`](backend/app/api/routes.py#L128).
- `POST /api/v1/embeddings/import` → **overwrite/poison the FAISS index** ([`routes.py:133`](backend/app/api/routes.py#L133)).
- `POST /api/v1/delete` → **remove any employee's enrollment** ([`routes.py:151`](backend/app/api/routes.py#L151)).
- `POST /api/v1/enroll` / `/identify` / `/recognize` → enroll arbitrary faces / run unlimited recognition.

The old design justified this by network-isolating the AI service on a private port. **That isolation no
longer exists** now that everything runs in one process on 8000. The stale `REVIEW.md` still recommends
"network-isolate the AI service," which no longer applies.

**Fix:** Add `Depends(get_current_user)` + `require_permission(...)` to every route in `routes.py` (e.g.
`recognition.view` / `recognition.manage` / `employees.manage` as appropriate). The newer
[`engine_api.py`](backend/app/api/engine_api.py) and [`recognition_api.py`](backend/app/api/recognition_api.py)
already do this correctly — mirror that pattern. For server-to-server/edge sync, use a dedicated device token,
not anonymous access.

### H-2 — Insecure defaults fail open in production
**✅ Fixed.** [`config.py`](backend/app/core/config.py) now has a `model_validator` that refuses to boot in
`production` with the default `secret_key` or a wildcard CORS origin, and forces `app_debug=False`. Also fixed an
underlying bug: `.env.example` documented `JWT_SECRET`/`JWT_EXPIRATION_MINUTES`, which were **not wired** to the
`secret_key`/`token_expire_minutes` fields (so the documented secret was silently ignored) — added
`AliasChoices` so both names work. *(Token TTL shortening / refresh tokens remain as P2.)*
[`app/core/config.py`](backend/app/core/config.py):
- `secret_key = "change-me-in-production"` ([L13](backend/app/core/config.py#L13)) with `HS256`. If `.env`
  is missing/misconfigured, **JWTs are forgeable** — anyone can mint a `sub` for any user id and the
  `get_current_user` lookup ([`dependencies.py:30`](backend/app/core/dependencies.py#L30)) will trust it.
- `app_debug = True` by default ([L10](backend/app/core/config.py#L10)) — verbose errors/stack traces.
- `token_expire_minutes` = 7 days ([L15](backend/app/core/config.py#L15)) with no refresh/rotation and no
  server-side revocation (logout is audit-only, [`auth.py:70`](backend/app/api/auth.py#L70)).

**Fix:** On startup, if `app_env == "production"`, assert `secret_key` was overridden and force
`app_debug = False`; refuse to boot otherwise. Shorten access-token TTL and add refresh tokens or a
revocation list.

### H-3 — CORS allows all origins *with* credentials
**✅ Fixed.** [`main.py`](backend/main.py) now reads explicit origins from `CORS_ALLOW_ORIGINS` (default the local
frontend) and only sets `allow_credentials=True` when origins are not wildcard.
[`main.py:55-61`](backend/main.py#L55-L61) sets `allow_origins=["*"]` together with
`allow_credentials=True` and `allow_methods/headers=["*"]`. This is an invalid+unsafe combination (browsers
reject credentialed wildcard, but it signals intent to allow any origin and will bite as soon as cookies are
introduced; it also broadens the attack surface for any token-in-header flow).

**Fix:** Restrict `allow_origins` to the known frontend origin(s) from config; only enable credentials for
those.

---

## 🟠 Medium severity

> **Update 2026-06-04:** M-1 through M-5 **fixed**. `pytest` 161 passed; rate limiter and config validated.

### M-1 — Tenant isolation is opt-in per-endpoint and missed in several places
**✅ Fixed.** Added `_employee_in_tenant_or_404` in [`rfid.py`](backend/app/api/rfid.py) and applied org scoping
to `list_employee_cards`, `add_employee_card`, `delete_card` (join → `Employee.organization_id`), and
`simulate_tap` (now uses the tenant-scoped `_get_reader_or_404`). *(Structural guard to replace per-endpoint
opt-in remains a worthwhile follow-up.)*
Isolation depends on each handler remembering to call `apply_tenant_filter(...)`
([`middleware/tenant.py`](backend/app/middleware/tenant.py)). It's easy to forget, and it has been:
- [`rfid.py:195` `list_employee_cards`](backend/app/api/rfid.py#L195) — filters only by `employee_id`, no
  org scoping and no permission check → any authenticated user can list **any** employee's RFID cards across
  tenants by iterating ids.
- [`rfid.py:215` `add_employee_card`](backend/app/api/rfid.py#L215) and
  [`rfid.py:244` `delete_card`](backend/app/api/rfid.py#L244) — require `rfid.manage` but never verify the
  target employee/card belongs to the caller's org → cross-tenant card assignment/revocation.
- [`rfid.py:296` `simulate_tap`](backend/app/api/rfid.py#L296) — loads any reader by id with no org check.

**Fix:** Prefer a structural guard (a base query helper or dependency that always injects the org filter)
over per-endpoint opt-in. At minimum, scope these endpoints by joining to `Employee.organization_id` /
`Location.organization_id` and validating against `TenantOrgId`.

### M-2 — In-memory duplicate-suppression cache: unbounded + not multi-worker safe
**✅ Fixed.** [`attendance_service.py`](backend/app/services/attendance_service.py): the in-memory cache is now
bounded (`_prune_dup_cache`, 10k cap with stale eviction) and demoted to a best-effort fast path. The
authoritative duplicate guard (`_recent_action_within`) is now based on the persisted record timestamps, which
are shared across all workers. *(Redis is referenced in the README but is not actually wired into the backend;
this fix avoids adding that dependency while making dedup correct across workers.)*
[`attendance_service.py:19`](backend/app/services/attendance_service.py#L19) `_dup_cache: dict[str, datetime]`
is a module-global that (a) **never evicts** entries → unbounded memory growth, and (b) is **per-process**, so
running uvicorn with >1 worker (or multiple nodes — which the README's horizontal-scaling NFR assumes) makes
the 60s duplicate window leak duplicates across workers.

**Fix:** Move duplicate suppression to Redis (already a stated dependency) with a TTL key, or enforce it at
the DB layer with a unique/partial constraint + upsert.

### M-3 — Attendance record creation has a check-then-insert race
**✅ Fixed.** The `(employee_id, work_date)` unique constraint already existed on the model, so duplicate *rows*
were not possible — but the race surfaced as an unhandled `IntegrityError` (→500). New
`_get_or_create_today_record` wraps the insert in a savepoint (`begin_nested`) and recovers from a concurrent
insert by re-selecting the winning row.
Both `process_recognition` and `process_rfid_tap` do `select ... where (employee_id, work_date)` then
conditionally `INSERT` ([`attendance_service.py:161-178`](backend/app/services/attendance_service.py#L161-L178)).
Two concurrent taps/recognitions for the same employee can both miss the existing row and create two records
for the same day (the in-memory dup cache does not protect across workers — see M-2).

**Fix:** Add a unique constraint on `(employee_id, work_date)` and use `INSERT ... ON CONFLICT` (or catch the
IntegrityError and re-select).

### M-4 — Cross-tenant read of visitor uploads
**✅ Fixed.** [`uploads.py`](backend/app/api/uploads.py) now takes `TenantOrgId` and returns 404 when a
non-super-admin requests a path outside their own organization.
[`uploads.py:12` `serve_visitor_upload`](backend/app/api/uploads.py#L12) authenticates the caller but does
**not** check that `org_id` matches the caller's tenant. Any logged-in user can fetch another org's visitor
photos/ID documents if they know the path. Exposure is limited because the filename is a random `uuid4` hex
(not enumerable — see [`upload_storage.py:59`](backend/app/services/upload_storage.py#L59)), but the URLs are
stored/returned in API responses and logs, so a leaked URL crosses the tenant boundary. Path traversal itself
is correctly mitigated by `_safe_filename` + the resolved-prefix check
([`upload_storage.py:113-121`](backend/app/services/upload_storage.py#L113-L121)).

**Fix:** Verify `org_id == TenantOrgId` (or that the visitor belongs to the caller's org) before serving.

### M-5 — No rate limiting on auth-sensitive endpoints
**✅ Fixed.** Added [`app/core/rate_limit.py`](backend/app/core/rate_limit.py) — a per-IP sliding-window limiter
(configurable, disable-able via `RATE_LIMIT_ENABLED`) applied to `/auth/login`, the recognition `identify`/
`recognize`/`recognize-stream` endpoints (both routers), and `/rfid/tap`. *(Best-effort/in-process; for hard
guarantees behind a load balancer, also limit at the reverse proxy.)*
There is no throttling on `POST /api/v1/auth/login` ([`auth.py:27`](backend/app/api/auth.py#L27)),
`/recognition/identify`, or the RFID/visitor device endpoints. Login is brute-forceable; recognition
endpoints are resource-intensive and unthrottled.

**Fix:** Add per-IP / per-account rate limiting (e.g. `slowapi` or reverse-proxy limits) on login and the
public-facing device/recognition routes.

---

## 🔧 Additional fixes found during remediation

- **A-1 — `process_recognition` call-signature mismatch (runtime `TypeError`).** `recognition_api.identify_face`
  called the service with `processing_ms`/`organization_id` and without the then-required `camera_id`, so every
  *matched* recognition through `/api/v1/recognition/identify` raised before writing attendance. **✅ Fixed** —
  widened the signature to the union both callers use (keyword-only, defaulted) in
  [`attendance_service.py`](backend/app/services/attendance_service.py); locked with contract tests in
  [`tests/test_attendance_service_contract.py`](backend/tests/test_attendance_service_contract.py).
- **A-2 — Matched recognitions were never logged as `RecognitionEvent`.** Only `unknown` rows were written, so
  the metrics endpoint's `matched` count was always 0 and the events list/exports never showed successful
  recognitions. **✅ Fixed** — [`recognition_api.py`](backend/app/api/recognition_api.py) now writes a
  `result="matched"` event (+ a `recognition.matched` live event) on success; covered by new
  [`tests/test_recognition_api.py`](backend/tests/test_recognition_api.py).
- **A-3 — Recognition events couldn't be tenant-scoped without a camera.** Events were scoped via
  `camera → location`, so camera-less events (from `/recognition/identify`) were invisible to org-scoped users.
  **✅ Fixed** — added a direct `organization_id` column to `recognition_events`
  ([model](backend/app/models/recognition.py) + migration
  [`d4e5f6a7b8c9`](backend/alembic/versions/d4e5f6a7b8c9_recognition_event_organization_id.py), which backfills
  existing rows from `camera → location`). Events are now stamped with the tenant on write (employee's org for
  matches, caller's org for unknowns), and every tenant-scoped query in
  [`recognition_api.py`](backend/app/api/recognition_api.py), [`monitoring.py`](backend/app/api/monitoring.py),
  and [`reports.py`](backend/app/api/reports.py) filters on `organization_id` directly (removing the fragile
  camera-join filters).

## 🟡 Low severity / hardening

- **L-1 — JWT `sub` is unvalidated `int()`.** **✅ Fixed** —
  [`dependencies.py`](backend/app/core/dependencies.py) now wraps `int(sub)` and returns 401 on a malformed
  value instead of raising a 500.
- **L-2 — Token in `localStorage`.** [`client.ts:11`](frontend/src/api/client.ts#L11) — **not changed
  (deliberate).** Migrating to httpOnly cookies is the right long-term fix but is an architectural change
  spanning login response handling, the axios client, and CSRF protection; it should be decided/scoped
  separately rather than bundled into this pass. Tracked as a follow-up.
- **L-3 — Broad `except` blocks.** **✅ Partially fixed** — the silent swallow around the attendance write in
  [`engine_api.py`](backend/app/api/engine_api.py) now logs a warning. A broader audit of the remaining ~45
  broad excepts is still recommended.
- **L-4 — Default admin credentials.** **✅ Fixed** — [`seed.py`](backend/seed.py) reads
  `SEED_ADMIN_PASSWORD` / `SEED_SUPERADMIN_PASSWORD`; outside `app_env=local` it refuses the well-known default
  and instead generates + prints a strong random password to rotate.
- **L-5 — Stale documentation.** **✅ Fixed** — `REVIEW.md` deleted. *(Reconciling the README's "AI service on
  private network" wording with the now-unified process is still worth a doc pass.)*

---

## Testing & CI

| Layer | Status |
|-------|--------|
| Engine unit tests | ✅ Present — 17 files under `backend/tests/` (engine + enrollment) |
| API/integration tests | ❌ None — no tests for auth, RBAC, tenant isolation, attendance writes, RFID tap |
| Frontend tests | ❌ None — `package.json` has no test runner (lint only) |
| CI/CD | ❌ None — no `.github/workflows` |

**Recommended minimum additions**
1. **Auth/RBAC/tenant tests** — the exact gaps above (H-1, M-1, M-4) are the highest-value regression tests:
   assert the AI router rejects anonymous calls; assert cross-tenant id access returns 403/404.
2. **Attendance concurrency test** — two concurrent taps create exactly one record (M-3).
3. **CI pipeline** — `pip install && alembic upgrade head && pytest` for backend; `npm ci && npm run lint &&
   npm run build` for frontend; run on PRs.

---

## What's done well

- **Single-writer attendance.** All attendance mutations funnel through `attendance_service`; the recognition
  engine never writes attendance directly ([`engine_api.py:104-118`](backend/app/api/engine_api.py#L104-L118)).
- **Consistent RBAC pattern.** `require_permission(...)` as a typed dependency with a `super_admin` bypass is
  clean and applied consistently across the *business* routers.
- **Password handling.** Argon2id with bcrypt deprecation + transparent rehash-on-login
  ([`security.py:12-29`](backend/app/core/security.py#L12-L29), [`auth.py:49`](backend/app/api/auth.py#L49)).
- **Device tokens hashed at rest.** RFID/device tokens stored as SHA-256, compared by hash
  ([`security.py:49-56`](backend/app/core/security.py#L49-L56), [`dependencies.py:84`](backend/app/core/dependencies.py#L84)).
- **Upload safety.** Filename sanitisation, extension allow-list, size cap, and resolved-path containment
  check in [`upload_storage.py`](backend/app/services/upload_storage.py).
- **Audit trail + GDPR retention config** are wired throughout sensitive operations.

---

## Prioritised action list

**P0 — before any internet exposure**
1. Authenticate/remove the AI router (H-1).
2. Fail-closed on `secret_key`/`app_debug` in production; restrict CORS (H-2, H-3).
3. Close RFID-card and upload tenant leaks (M-1, M-4).

**P1 — reliability & correctness**
4. Move duplicate suppression to Redis + add `(employee_id, work_date)` unique constraint (M-2, M-3).
5. Add rate limiting on login and device/recognition endpoints (M-5).
6. Add API/RBAC/tenant integration tests + a CI pipeline.

**P2 — hardening & hygiene**
7. Shorten token TTL / add refresh + revocation (H-2).
8. Audit broad `except` blocks; validate `sub` parsing (L-1, L-3).
9. Force default-admin rotation; delete stale `REVIEW.md` (L-4, L-5).

---

*Based on static analysis of repository structure, configuration, routes, dependencies, and representative
services. Runtime behaviour and recognition accuracy were not benchmarked.*
