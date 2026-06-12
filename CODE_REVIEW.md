# Code Review -- AI Attendance Platform

Date: 2026-06-12
Method: 8-dimension multi-agent review (security, backend correctness, data model,
recognition engine, frontend, testing/CI, ops/packaging, prior-review follow-up).
31 agents; every high/critical finding was put through an adversarial verifier that
tried to refute it against the actual code. Zero findings were rejected; several
severities were adjusted to be fair. All 15 items from the prior REVIEW.md are
confirmed resolved -- this report is new ground.

Severity legend: CRITICAL = data corruption or security hole; HIGH = real bug or
serious operational risk; MEDIUM = meaningful quality/maintainability issue;
LOW = polish.

---

## Tier 1 -- Correctness bugs that silently break the core product

These corrupt or lose attendance data, which is the entire purpose of the system.

### 1. [CRITICAL] Timezone handling corrupts the attendance ledger
- Files: `backend/app/services/attendance_service.py:247-248` (write), `backend/app/api/attendance.py:102` (read), also `backend/app/services/monitoring_service.py:122`, `backend/app/services/rfid_service.py:110`, `backend/app/api/reports.py:74`.
- Problem: check-in/out derives `work_date` from UTC (`datetime.now(timezone.utc).date()`),
  but every read path uses server-local `date.today()`. Lateness compares a UTC clock
  time against the shift's local wall-clock `start_time` via `.replace(...)`.
- Impact: on any non-UTC deployment (i.e. essentially every real Windows box), an
  evening punch lands on tomorrow's UTC `work_date`, opens a new next-day record, logs
  the check-out as a check-in, and never closes today's record -- while the dashboard
  (querying local date) cannot see it. Lateness is systematically wrong (everyone "late"
  west of UTC, never late east of it). `settings.app_timezone` exists but is referenced
  nowhere in app code.
- Fix: pick one timezone authority (`settings.app_timezone` or per-location tz), convert
  `now` to that zone before deriving `work_date` and before comparing to `Shift.start_time`,
  and use the same zone in the "today" queries. Add tests for punches near midnight and
  shift-start boundaries in a non-UTC zone.

### 2. [CRITICAL] Live camera attendance events are never persisted
- File: `backend/app/engine/attendance_generator.py:160-172`.
- Problem: `AttendanceGenerator.generate_event` appends events to an in-memory
  `_event_queue`, but `drain_events()` has no callers outside tests. The continuous
  RTSP pipeline (`recognition_engine._recognize_tracked_face`) has no DB session anywhere
  under `app/engine/`. Only the HTTP `/recognize` path persists attendance.
- Impact: recognitions from running camera streams -- the headline feature -- are counted
  in metrics but never written to `attendance_records`, and the queue grows unbounded
  (memory leak) for the process lifetime.
- Fix: add a consumer (background task or a callback from `_recognize_tracked_face`) that
  drains the queue through `attendance_service.process_recognition` in a DB session and
  commits per batch; bound the queue (`deque(maxlen=...)`).

### 3. [HIGH] Deleting an employee destroys history and leaves live biometric vectors
- File: `backend/app/api/employees.py:128-149`.
- Problem: `DELETE /employees/{id}` does a hard `db.delete(emp)` with no guard.
  `attendance_records.employee_id` is `ondelete=CASCADE`, so attendance/payroll history,
  shift assignments, leave requests, and face embeddings are irreversibly destroyed by a
  routine admin action. The FAISS index is never cleaned (`face_service.delete_employee`
  is only called from the privacy endpoint), so the deleted person's vectors stay live and
  matchable -- and `process_recognition` then 500s on every sighting because the FK is gone.
  Also a GDPR retention problem (biometrics of a "deleted" person persist).
- Fix: soft-delete (`is_active=False`) or block deletion while attendance history exists.
  If hard delete must remain, change the FK to `ondelete=RESTRICT` and call
  `face_service.delete_employee(str(id))` first. Make `process_recognition` bail out when
  the employee row is missing.

---

## Tier 2 -- Cross-tenant and auth security holes

### 4. [HIGH] Face recognition is not tenant-scoped
- Files: `backend/app/services/face_service.py` (recognize/identify), `backend/app/services/recognition_service.py:158-176` (record_identification), `backend/app/services/faiss_index.py`.
- Problem: the FAISS index and the match path are global with no `organization_id`
  dimension. The employee branch of `record_identification` does
  `employee = await db.get(Employee, employee_id)` with no check that the matched employee
  belongs to the caller's org -- the visitor branch right next to it DOES gate on org.
- Impact: an authenticated user in org B can POST a face image, match against org A's
  enrolled employees, receive their identity (id/code/name), and even create attendance /
  live events for another tenant's employee.
- Fix: maintain per-org FAISS indexes/metadata, or filter candidate matches by
  `organization_id` before accepting, and reject (treat as unknown) any match whose
  `employee.organization_id != caller org_id`.

### 5. [HIGH] Recognition event snapshots are readable across tenants (IDOR)
- Files: `backend/app/api/recognition.py:153-160` (get_event_snapshot), `backend/app/services/recognition_service.py:404-414` (snapshot_path).
- Problem: the endpoint gates on `recognition.view` but takes no org context, and
  `snapshot_path()` loads the `RecognitionEvent` purely by sequential integer id with no
  `organization_id` filter, then returns the stored face snapshot file. Every sibling
  endpoint filters org; this one is the lone omission.
- Impact: a user with `recognition.view` in org A can enumerate event ids and download
  face snapshot images belonging to org B.
- Fix: thread `TenantOrgId` into `get_event_snapshot`/`snapshot_path` and add
  `RecognitionEvent.organization_id == org_id` (when not None), returning 404 on mismatch.

### 6. [HIGH] The entire visitor-management API has no permission checks
- File: `backend/app/api/visitors.py` (create:180, update:225, enroll-face:257, check-in:274, check-out:301, approve:339, cancel:366, blacklist add:769 / delete:809).
- Problem: `visitors.py` contains zero `require_permission` calls while every comparable
  module gates writes. All 29 visitor routes depend only on `CurrentUser` + `TenantOrgId`.
  The `visitors.manage`/`visitors.view` permissions are defined in bootstrap and granted to
  roles, but enforced nowhere.
- Impact: any authenticated user -- including a self-registered default-role account
  (which has org_id=None and so bypasses the tenant filter entirely) -- can create/modify
  visitors, enroll/replace visitor face biometrics, check visitors in/out, approve access,
  and edit the blacklist across all orgs. In a physical-access product this is a real
  security-bypass surface.
- Fix: add `require_permission` dependencies to every mutating and sensitive visitor
  endpoint, mirroring `employees.py`/`enrollment.py`.

### 7. [HIGH] .env.example silently defeats the production secret-key guard
- Files: `backend/.env.example:3-4,15,41`, `backend/app/core/config.py:296-312`.
- Problem: `config.py` fails closed only on the exact default string
  (`change-me-in-production`). The committed example sets `APP_ENV=production` with
  `JWT_SECRET=change-me-to-a-random-64-char-string` -- a different placeholder that PASSES
  the guard. `README.md:37` instructs `cp .env.example .env`. (The verifier booted Settings
  with these exact values: it started in production mode with the repo-public key.)
- Impact: following the documented quickstart boots a "production" instance whose HS256
  JWT signing key is committed to the repo -- every auth token is forgeable. The example
  also ships `DB_PASSWORD=123456789`, normalizing weak DB passwords.
- Fix: set the example `JWT_SECRET` to the exact default (or empty) so the guard trips,
  default `APP_ENV=local`, reject any `change-me*`/short secret in the validator, and
  replace `DB_PASSWORD` with an obvious placeholder.

### 8. [HIGH] SSRF via client-supplied stream_url
- Files: `backend/app/api/recognition.py:107-124`, `backend/app/api/engine.py:155-170`, `backend/app/services/stream_capture.py:11-16`.
- Problem: both endpoints accept a client-supplied `stream_url` (only `CurrentUser`, no
  permission) and pass it straight to `cv2.VideoCapture(stream_url)`, which opens
  http(s)/rtsp/file backends. With self-registration on by default, this is reachable by
  outsiders who self-register.
- Impact: blind SSRF -- the server can be coerced into connecting to internal hosts
  (e.g. `169.254.169.254` metadata, internal admin panels); reachability/timing is
  inferable from differing error strings.
- Fix: require a manage-level permission and validate `stream_url` (scheme allowlist,
  block RFC1918/link-local/loopback/metadata). Prefer referencing a pre-registered
  `camera_id` over accepting raw URLs.

### Tier 2 -- additional (MEDIUM/LOW, not adversarially re-verified)
- [MEDIUM] Self-registration is enabled by default (`config.py:193`), exposing the
  recognition/engine compute endpoints (which require only `CurrentUser`) to anyone who can
  register. Default to `False`; require a coarse `recognition.use` permission.
- [MEDIUM] JWTs cannot be revoked: logout and password change leave existing tokens valid
  (`core/security.py:32-46`, `auth.py:129-208`); default lifetime is 7 days. Add a
  `token_version`/`password_changed_at` claim verified in `get_current_user`, or a Redis
  jti denylist; reduce the default lifetime.
- [MEDIUM] Roles/permissions are global (no `organization_id`), so an org admin with
  `roles.manage` can edit roles shared by all tenants and mint high-privilege roles
  (`users.py:291-367`). Scope roles to an org or restrict role management to super admins.
- [LOW] Committed `.env.example` ships weak/placeholder secrets used as the operator
  template (`DB_PASSWORD=123456789`, placeholder JWT). Use obviously-invalid placeholders.

---

## Tier 3 -- Recognition engine robustness (camera path is fragile)

### 9. [HIGH] Engine auto-accept threshold (0.90 cosine) is miscalibrated for ArcFace
- File: `backend/app/engine/config.py:72-77`.
- Problem: the engine hardcodes `auto_accept_threshold=0.90`, but the codebase's own
  config comments say genuine ArcFace pairs score ~0.4-0.7, and the kiosk path uses 0.5
  against the same index. The configurable `settings.engine_auto_accept_threshold` /
  `engine_review_threshold` are dead code, and REVIEW-band matches are silently dropped
  (no review queue).
- Impact: at defaults the camera engine marks nearly all real employees UNKNOWN -- no
  attendance, plus a flood of false unknown-person alerts.
- Fix: calibrate against real ArcFace score distributions (~0.45-0.6 accept), wire the
  settings into `engine_config` at startup, and route REVIEW results to a persisted queue.

### 10. [HIGH] FaissIndex is not thread-safe and rewrites the whole index per add
- File: `backend/app/services/faiss_index.py:40-56`.
- Problem: no locking. `add()` calls `faiss.write_index` of the whole index plus full
  metadata JSON per embedding; `add_batch()` first does a full O(N) `remove_employee()`
  rebuild, so a 10-image enroll = ~11 full index writes. Recognition searches the same
  instance from threadpool threads while enrollment mutates it.
- Impact: `IndexFlat.add()` can reallocate storage while `search()` reads it
  (segfault risk); `remove_employee` swaps `self.index` mid-search (misidentification);
  interleaved saves can leave index and metadata files mismatched.
- Fix: guard mutation+save and search with a `threading.Lock`, batch adds into one
  `index.add(np.vstack(...))` + a single save, and write atomically (temp file + os.replace).

### 11. [HIGH] Stream stop/shutdown races VideoCapture.release() against in-flight read()
- File: `backend/app/engine/stream_manager.py:202-231`.
- Problem: the read loop runs `await asyncio.to_thread(stream._capture.read)`; `stop()`,
  `stop_stream()`, and `remove_stream()` call `stream._capture.release()` while that read
  may still be executing in a worker thread (cv2 is not thread-safe -- undefined behavior).
  `stop()` also never cancels/awaits the per-stream tasks, and `_connect_stream` sets no
  FFmpeg open/read timeouts.
- Impact: a normal admin operation during active streaming can crash the entire backend.
- Fix: in stop paths only signal `_running=False`, then cancel and await each task and let
  `_stream_loop`'s own cleanup release the capture. Set `CAP_PROP_OPEN_TIMEOUT_MSEC` /
  `CAP_PROP_READ_TIMEOUT_MSEC`.

### 12. [HIGH] Camera reconnect gives up permanently after ~50s; offline alert is dead code
- File: `backend/app/engine/stream_manager.py:333-341`.
- Problem: after `max_reconnect_attempts` (10 x 5s = ~50s) the loop `break`s to OFFLINE
  forever; the health monitor never restarts a dead task. `metrics.record_camera_offline`/
  `record_camera_health` have no production callers, so CAMERA_OFFLINE/HIGH_LATENCY alerts
  never fire.
- Impact: a routine NVR reboot or network blip over ~1 minute silently stops attendance for
  that camera until a manual restart, with no operator signal.
- Fix: replace the hard give-up with capped exponential backoff that retries indefinitely
  (or have the health monitor restart ERROR/OFFLINE streams), and call the camera-health
  metrics from the stream loop.

### 13. [MEDIUM] Engine searches a separate, stale FAISS instance
- File: `backend/app/engine/vector_search.py:86-93`.
- Problem: `VectorSearchEngine` lazily builds its own `FaissIndex()`, while enrollment
  writes to a different singleton (`face_service.get_index()`). Nothing calls
  `get_vector_search().reload()` after enrollment.
- Impact: the live camera engine flags freshly enrolled employees as UNKNOWN (false alerts,
  missed camera attendance) until a manual `/engine/index/reload` or process restart. The
  primary kiosk path is unaffected (it uses the same singleton enrollment writes to).
- Fix: have `VectorSearchEngine` reuse `face_service.get_index()`, or call `.reload()`
  after every `add_batch`/`remove_employee`; for multi-worker, check `version_hash()`.

### 14. [HIGH] Manual attendance endpoint: naive/aware datetime crash + no tenant scoping
- File: `backend/app/api/attendance.py:131-177`.
- Problem: (1) `datetime.fromisoformat(body.check_out_at)` accepts naive strings (the UI
  DatePicker sends `YYYY-MM-DDTHH:mm`); subtracting from a tz-aware `check_in_at` raises
  TypeError -> 500 on the common "fill in missing checkout" flow. (2) Malformed input is
  uncaught -> 500 instead of 422. (3) The endpoint never checks `body.employee_id` against
  the caller's org, so an org-A admin can write attendance for org-B employees.
- Fix: type the fields as `datetime` in the Pydantic schema with a validator that requires
  a timezone, validate `check_out > check_in`, and load the employee via
  `apply_tenant_filter`/`TenantOrgId` before touching the record.

### Tier 3 -- additional (MEDIUM)
- [MEDIUM] Every successful RFID first check-in is misreported as `duplicate_ignored`
  (`backend/app/services/rfid_service.py:445-456`): the action is re-derived from timestamps
  after the write instead of returned by `process_rfid_tap`. The attendance row is correct;
  only the event log / device response / realtime feed misclassify it.
- [MEDIUM] Argon2 hashing (64MB, time_cost=4) runs synchronously on the event loop in
  login/register/change-password (`backend/app/api/auth.py:47,54,100,190-196`) -- wrap in
  `run_in_threadpool`, matching the face-service pattern. (Bounded by rate limits; kiosk hot
  path uses SHA-256 device tokens.)
- [MEDIUM] Liveness anti-spoofing is heuristic-only; the model hooks and the
  detect_printed_photos/screen_replays/deepfakes/face_swaps config flags are dead code
  (`backend/app/engine/liveness_detector.py:88-90`). Wire a real anti-spoof model or
  document that the engine path is heuristic-only.
- [MEDIUM] Model-level `lazy='selectin'` defaults fan out hidden queries on the hot
  recognition path (`db.refresh(record)` after flush re-fires cascading loads) and on some
  list endpoints. Default to `lazy='select'` and opt in with `selectinload(...)`.

---

## Tier 4 -- Process and quality gaps (cheap, high-leverage)

### 15. [MEDIUM] No CI pipeline exists anywhere
- No `.github/workflows`, `.gitlab-ci.yml`, Jenkinsfile, etc. Yet the suites are fast and
  hermetic: `pytest` passes 287 backend tests in ~11s with no live DB; `vitest` passes 16
  frontend tests in ~2s. Recent history shows large direct-to-main feature commits with
  nothing gating them.
- Fix: add `.github/workflows/ci.yml` with a backend job (pip install + pytest) and a
  frontend job (npm ci + lint + `tsc -b` + `vitest run` + build). Nearly free.

### 16. [MEDIUM] Security-critical code has zero behavioral tests
- Auth/JWT issuance (`backend/app/api/auth.py`, `core/security.py`): no test posts to
  `/auth/login` or exercises `create_access_token`/`get_current_user`. Every API test
  overrides auth via `dependency_overrides`.
- Tenant isolation (`get_tenant_org_id`, `backend/app/core/dependencies.py:104-137`): the
  multi-tenant boundary is mocked out in every test (`lambda: 1`), never tested itself.
- Attendance check-in/out state machine: only inspect-based signature tests exist
  (`backend/tests/test_attendance_service_contract.py`); no test runs a check-in then
  check-out and asserts the resulting record.
- Fix: add `tests/test_auth.py`, direct unit tests for `get_tenant_org_id`, and behavioral
  tests for `process_recognition` against an aiosqlite/Postgres session.

### 17. [MEDIUM] No DB-backed tests; no backend lint/format/type tooling; frontend strict off
- All 287 backend tests use hand-rolled fakes; real SQL, the `UNIQUE(employee_id, work_date)`
  constraint the dup logic depends on, and the alembic chain are never exercised.
- No ruff/flake8/black/isort/mypy and no pre-commit anywhere; no pytest-cov.
- Frontend `strict` mode is OFF in every tsconfig (`frontend/tsconfig.app.json`), so
  implicit `any` and unchecked nulls compile silently -- the apparent type cleanliness is
  partly illusory. ESLint uses only `recommended` (not type-checked tiers).
- Fix: add an aiosqlite/Postgres integration layer (run `alembic upgrade head` then exercise
  CRUD); add ruff + mypy + pytest-cov in `backend/pyproject.toml`; set `"strict": true` and
  fix incrementally; upgrade ESLint to `recommendedTypeChecked`.

### 18. [MEDIUM] Frontend auth/session and WebSocket plumbing
- JWT (7-day) stored in `localStorage` (`frontend/src/shared/lib/session.ts`) -- full XSS
  exfiltration exposure; no CSP. Prefer an httpOnly SameSite cookie, or shorten lifetime +
  add refresh rotation + serve a CSP.
- 401 triggers a hard `window.location.href='/login'` that discards location and unsaved
  state, with no `?next=` return URL; `sessionExpired` reducer and `onTokenChange` are dead
  code (`frontend/src/shared/api/client.ts:43-54`).
- Three ad-hoc WebSocket hooks (`dashboard/api/queries.ts`, `recognition/api/queries.ts`,
  `recognition/WebcamMonitor.tsx`) duplicate connect logic, capture a stale token once, and
  reconnect every 1.5s with no backoff. Extract a shared `useAuthedWebSocket` hook modeled
  on `RealtimeContext` (fresh token per attempt, exponential backoff).

### 19. [MEDIUM] Ops/packaging polish
- No logging configuration anywhere in the backend: no `dictConfig`/`basicConfig`, so all
  `logger.info(...)` calls propagate to a handler-less root logger and are dropped; only
  WARNING+ leak out, unformatted and unrotated. A background loop uses raw `print()`
  (`backend/app/api/visitors.py:836-838`). Add a logging setup module + `LOG_LEVEL` setting.
- Health endpoint (`backend/app/api/health.py:37-67`) checks only DB and FAISS, never Redis
  or Celery, though both are required in production -- with Redis down, `/health` still
  returns "healthy" while rate limits, live updates, and all periodic jobs silently stop.
- ~462 MiB of dangling binary blobs in `.git` (a 356 MB EXE was once staged). Run
  `git gc --prune=now`; add a max-blob-size pre-commit guard; keep installer output out of
  the repo root.
- README documents thresholds/env vars that do not exist: the `0.95` recognition threshold
  (actual default 0.5), `NFR_*`-prefixed env vars (no such prefix in code), and
  `DB_SSLMODE=require` (silently ignored -- no `sslmode` field, so DB traffic is NOT
  encrypted despite the advice). Fix the text or wire in a `db_sslmode` setting.
- No PostgreSQL + FAISS backup/restore guidance. Face embeddings live OUTSIDE Postgres
  (FAISS `data/faiss.index` + `metadata.json`); a restore of one without the other leaves
  rows and embeddings out of sync. Document snapshotting `pgdata` and `appdata` as one unit.

### 20. Data model nits (MEDIUM/LOW)
- [MEDIUM] `engine_*` migrations create `status`/`result` as varchar while the models
  declare native PG enums (`backend/alembic/versions/c3d4e5f6a7b8_*.py` vs
  `backend/app/models/engine.py`), and omit `nullable=False` on most columns -- autogenerate
  will emit destructive diffs. Add a corrective migration.
- [MEDIUM] `employees.employee_code` is globally unique instead of per-org
  (`backend/app/models/employee.py:30`) -- two tenants cannot both have "EMP-001". Replace
  with `UniqueConstraint("organization_id", "employee_code")`.
- [MEDIUM] Holidays unique constraint is ineffective for org-wide rows (NULL `location_id`
  is distinct in Postgres), so duplicate org-wide holidays can be inserted
  (`backend/app/models/attendance.py:129-143`). Use NULLS NOT DISTINCT or partial indexes.
- [MEDIUM] Missing indexes on hot FK columns: `recognition_events.employee_id`,
  `leave_requests.employee_id`, `visitors.host_employee_id`,
  `attendance_records.location_id`/`camera_id`.
- [LOW] `created_at`/`updated_at` are nullable and `updated_at` is not maintained at the DB
  level (`backend/app/models/base.py:13-19`). Make NOT NULL with `server_default=func.now()`.
- [LOW] Models lag migrations: `FaceEmbedding` missing the
  `ix_face_embeddings_employee_id_is_active` index in `__table_args__`; `VisitorLog.created_at`
  uses `server_default="now()"` as a literal string instead of `func.now()`.
- [LOW] `AttendancePolicy.weekend_days` / `Shift.days_of_week` are typed `Mapped[dict]` but
  store lists of ints. Fix the annotation to `Mapped[list[int] | None]`.

---

## Tier 5 -- Non-functional requirement (NFR) roadmap status

From `docs/NFR_GAP_ANALYSIS.md`. These are tracked, deliberately-deferred architecture items
for an offline single-Windows-box product -- not regressions. Listed so they are not
re-discovered.

- [HIGH] Phase 2: inference is still CPU-only (all four ONNX entry points hardcode
  `CPUExecutionProvider`); no GPU option, no recognition worker queue/batching. The 300ms SLA
  sits on this unchanged CPU path. (`backend/app/engine/face_detector.py:113` et al.)
- [MEDIUM] Phase 3: 99.99% availability is structurally impossible on the shipped single-box
  topology (one Postgres, one Redis, one uvicorn with no `--workers`, one Celery). The
  committed baseline is actually 99.9% (README NFR-004) -- re-baseline the doc to stop
  re-reporting this. (`windows/launcher/AttendanceLauncher/Program.cs:189-195`)
- [MEDIUM] Phase 2: FAISS is still exact flat `IndexFlatIP` (brute-force) -- fine at the 10k
  design point, but the 100k-employee target needs an ANN index (IVF/HNSW).
- [MEDIUM] Phase 3: camera ingest is still one asyncio loop per camera inside the API process
  -- workable for ~100 cameras, not the 5,000 target. Needs an edge/worker fleet.
- [MEDIUM] Phase 0: the k6 load-test harness exists but is wired into no CI regression gate
  and has no recorded baseline results.
- [LOW] Phase 1: multi-worker uvicorn exists only as an opt-in `run.ps1` flag; the default
  run and the packaged tray launcher still launch a single worker.

---

## What is genuinely good (baseline)

argon2 hashing; rate-limited login/register; a fail-closed production secret/CORS validator;
tenant filtering on most CRUD; super-admin role guards; exponential-backoff reconnect on the
main WebSocket; TanStack Query used uniformly with centralized error toasting; route guards
mirroring backend permissions; a strong 287-test engine unit suite; no committed build
artifacts; a clean single-chain alembic history; deliberate N+1 suppression and
UNIQUE-constraint-backed race handling on the main attendance path. The architecture is sound
-- the items above are specific, fixable gaps, not a rewrite.

---

## Suggested order of work

1. Tier 1 (timezone, live-stream persistence, employee-delete) -- these silently corrupt or
   lose attendance data.
2. Tier 2 security pass (tenant-scope recognition, snapshot IDOR, visitor RBAC,
   .env.example/secret guard, SSRF).
3. Scaffold CI (item 15) to lock in regressions before further change.
4. Tier 3 engine robustness, then Tier 4 quality/process, then data-model migrations.
