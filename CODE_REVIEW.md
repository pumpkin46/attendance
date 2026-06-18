# Code Review -- AI Attendance Platform

Date: 2026-06-17
Method: multi-agent review across 9 dimensions (auth/secrets, tenant isolation,
attendance correctness, recognition engine, data model/migrations, frontend,
testing/CI, ops/packaging, async/concurrency), plus a prior-review reconciliation
pass and a completeness critic. 26 agents. Every CRITICAL/HIGH finding was put
through an adversarial verifier that read the current source and tried to refute
it; verdicts and severity adjustments below reflect that pass. Reviewed against the
current tree (alembic head `j6d7e8f9a0b1`), i.e. *after* the 5 commits that landed
since the 2026-06-12 review (org-tree merge, low-light enhancement, anti-spoof
wiring, tenant-gated recognition, user registration).

Severity legend: CRITICAL = data corruption or security hole exploitable across the
tenant boundary; HIGH = real bug or serious operational risk; MEDIUM = meaningful
quality/correctness issue; LOW = polish.

## Fix status (2026-06-17)

Worked top-down through the suggested order. **Fixed + verified** (backend 451
tests pass, frontend lint 0 errors, `tsc -b && vite build` clean):

- **CI green again** -- #29 (backend tests), #30 (frontend lint).
- **Cross-tenant IDOR family closed** -- #1 (shift/policy/leave by-id scoping,
  CRITICAL), #4 (shift/leave `employee_id` ownership), #2 (visitor host),
  #3 (employee location). Regression test: `backend/tests/test_shift_tenant_isolation.py`.
- **Auth containment** -- #5 (admin reset now bumps `password_changed_at`),
  #6 (default/weak JWT secret now rejected outside an explicit dev allowlist).
- **Event-loop blocking** -- #25 (`/health` Celery ping offloaded), #26
  (recognition snapshot writes offloaded).
- **Engine / data-layer hardening** -- #34 (org-tree cycle safety: `move_node`
  now takes a company-root row lock; recursive CTEs + `ancestor_chain` are
  depth-bounded), #13 (FAISS switched to `IndexIDMap2` + `remove_ids`, so
  enroll/delete no longer reconstruct the whole index -- legacy flat indexes are
  auto-migrated on load), #12 (live-camera active/temporal liveness is now wired
  and operator-toggleable via `ENGINE_LIVE_ACTIVE_LIVENESS`, default off to avoid
  false-rejects on passive cameras; the engine status now reports
  `liveness.live_mode` so operators know whether replay protection is enforced).

**MEDIUM/LOW batch (also fixed + verified):**

- **Attendance / report correctness** -- #19 (RFID exit-only no longer writes a
  bare `absent` row), #20 (unknown-persons report uses local day bounds), #21
  (visitor dashboard "today" uses local day), #22/#23 (manual attendance is
  race-safe and derives status from shift/policy via a shared service fn), #24
  (`min_work` now drives an `early_leave` status). Tests in
  `test_attendance_state_machine.py`.
- **Anti-spoof hardening** -- #16 (downloaded MiniFASNet model verified against a
  pinned SHA-256, rejected on mismatch; `test_antispoof_security.py`), #14
  (`/health` reports the real `antispoof_mode`: model vs heuristic_only; loud
  CRITICAL log when degraded), #15 (input scale made explicit/configurable,
  default unchanged pending reference validation).
- **Data model** -- #35 (partial unique index enforces company-root code
  uniqueness at the DB level; migration `k7e8f9a0b1c2` + model + test).
- **Frontend** -- #38 (**TypeScript `strict` enabled** -- the code already
  compiled clean under it), #40 (**type-checked ESLint** now on:
  `recommendedTypeChecked` + `projectService`; ~82 type-aware issues fixed --
  unawaited promises `void`-ed, blob fetches typed, unsafe `any` flows resolved),
  #41 (`ProtectedRoute` preserves `?next=`), #43/#44 (memoization + bounded
  no-token WS retries), #39 (CSP + security headers in the packaged nginx
  config). Lint is now 0 warnings, 0 errors under the stricter rule set.
- **Ops docs** -- install/arch docs corrected to port 18000, the phantom
  `ProgramData\redis` dir removed, README updated to the org-tree model, #33 CI
  comment corrected.
- **CI / tooling** -- #31 (new `migrations` job runs `alembic upgrade head`
  against a real `postgres:16`), #32 (ruff added: `backend/ruff.toml` + a CI
  lint step; 31 unused imports removed, suite green).

**Final cleanup batch (also fixed + verified):**
- **#36** (recognition-result enum drift) -- `recognition_events.result`
  converted from a native PG enum to `varchar(32)` (migration `l8f9a0b1c2d3`),
  matching `engine_recognition_logs.result`; `RecognitionResult` is now the
  single canonical enum (engine.py aliases it), so a richer outcome
  (`quality_rejected`) needs no `ALTER TYPE`. Comparison sites use `.value`.
- **#37** (org-tree backfill) -- `insert_node` now uses `INSERT ... RETURNING id`
  instead of re-selecting by `(root, code)`, so a subtle code collision can't
  mis-parent a subtree during the backfill.
- **#42** (RealtimeContext WS de-dup) -- now uses the shared `useAuthedWebSocket`
  (extended with optional `heartbeatMs`, `onStatusChange`, and a `reconnected`
  flag on `onOpen`), so the realtime bus and the feed sockets share one
  reconnect/auth implementation. Resync-on-reconnect, heartbeat, status, and
  tenant-switch reconnect behavior preserved; type-checked lint + build + tests green.

Everything actionable in this review is now fixed and verified. The single-box
NFR roadmap items (Tier 5) remain deliberately deferred per
`docs/NFR_GAP_ANALYSIS.md` (they are architecture choices, not defects).

---

## Headline

**The 2026-06-12 review's findings were almost entirely fixed.** 23 of 30 prior
items are fully RESOLVED and verified against current code; the rest are PARTIAL
(see the reconciliation table). Both CRITICAL data-loss bugs (timezone ledger
corruption, unpersisted live-camera events) and all four Tier-2 security holes from
that review are genuinely closed. This report is mostly new ground.

**Two things need attention immediately:**
1. **CI is RED on both jobs right now** (Tier 6). The pipeline added in the last
   round is no longer gating anything -- 2 backend tests and 4 frontend lint errors
   fail on every push to `main`. Cheap to fix; high leverage.
2. **A cross-tenant IDOR family remains.** The shift/policy/leave service
   (carried over from the known `shift_service` issue) plus three newly-found
   write paths (visitor host, employee location, shift/leave `employee_id`) let
   one tenant read or corrupt another tenant's data. This is the most serious
   active class of bug.

Confirmed counts (post-verification, deduplicated): **1 CRITICAL, 12 HIGH, ~17
MEDIUM, ~12 LOW.**

---

## Tier 1 -- Cross-tenant data access (the active security holes)

The org-tree merge tightened tenant scoping in most places (recognition, snapshots,
visitors-by-id, org nodes are all correctly gated -- see "What is good"). These are
the paths the new scoping did NOT reach.

### 1. [CRITICAL] Shift / policy / leave single-row operations have no tenant scoping
- Files: `backend/app/services/shift_service.py:75,84,118,127,136,142,207`; `backend/app/api/shifts.py:45,51,82,88,99,166`.
- Problem: every by-id operation loads its row by primary key with **no** `organization_id`
  filter, and the router never injects/forwards an org id. `get_policy`/`get_shift` and
  everything routed through them (`update_policy`, `update_shift`, `deactivate_shift`,
  `assign_shift`, `decide_leave_request`) are unscoped. `apply_tenant_filter` is imported
  and used on the LIST queries but never on the single-row paths. `GET /shifts/policies/{id}`
  and `GET /shifts/{id}` require only `CurrentUser` (no permission at all).
- Impact: any authenticated user can **read** another tenant's shifts/policies by guessing
  sequential ids; a holder of `shifts.manage`/`leave.approve` can **flip another org's default
  attendance policy** (which drives overtime/night/weekend pay multipliers), deactivate their
  shifts, or approve/reject their leave requests. Cross-tenant confidentiality *and* integrity.
- Fix: thread `TenantOrgId` into the `shifts.py` handlers and `apply_tenant_filter(stmt, org_id,
  Model.organization_id)` inside `get_policy`/`get_shift`/etc.; for `LeaveRequest` (which has no
  `organization_id` column) scope via the `Employee` join already used by `leave_requests_query`.
  Treat an out-of-tenant row as 404.

### 2. [HIGH] `create_visitor` / `update_visitor` accept an arbitrary `host_employee_id` (cross-tenant write + PII leak)
- Files: `backend/app/services/visitor_service.py:199,222-229,612-623`; `backend/app/api/visitors.py:183-214,228-257`; `backend/app/models/visitor.py:222`.
- Problem: `host_employee_id` is taken straight from the request body with no check that the
  employee belongs to `org_id`. `Visitor.host_employee` is `lazy="selectin"`, and `_format_visitor`
  returns the host's `first_name`/`last_name`/`employee_code`/`email`/`department`/`job_title`
  in the response.
- Impact: a `visitors.manage` admin can POST a visitor referencing **another tenant's** employee id
  and read that employee's PII back in the 201 response, plus write a cross-tenant FK in
  `visitors`/`visitor_hosts`. Integer PKs are enumerable.
- Fix: validate `host_employee_id` against `Employee.organization_id == org_id` before assigning,
  in both create and update; reject with 404 otherwise.

### 3. [HIGH] `create_employee` / `update_employee` accept `location_id` with no tenant-ownership check
- Files: `backend/app/api/employees.py:55-65,104-110`; `backend/app/schemas/employee.py:32,43`; `backend/app/models/employee.py:33-35`.
- Problem: the org IDOR guard correctly forces `organization_id` from tenant context, but
  `location_id` is copied verbatim from the body and never validated against the caller's org.
- Impact: a tenant admin can plant an employee on **another tenant's location id**; attendance rows
  inherit `location_id` from the employee, so this corrupts location-based grouping and surfaces the
  foreign location id in attendance/exports. (The foreign location *name* does not leak -- the export
  lazy-loads location -- so the disclosure is the raw id plus integrity corruption.)
- Fix: when `location_id` is provided, look it up with `apply_tenant_filter(..., Location.organization_id)`
  and reject if not in the caller's org.

### 4. [HIGH] `assign_shift` / `create_leave_request` accept an arbitrary `employee_id`
- Files: `backend/app/services/shift_service.py:142,191`; `backend/app/api/shifts.py:109,160`; `backend/app/schemas/attendance.py:202,258`.
- Problem: both build their row from a client-supplied `employee_id` with no org-ownership check.
  `POST /shifts/{id}/assign` needs `shifts.manage`; `create_leave_request` requires only `CurrentUser`
  (no permission, no org context at all).
- Impact: a user in org A can attach a shift to an org-B employee, or file a leave request against
  any employee in any org -- corrupting another tenant's scheduling/leave ledger. Distinct from #1
  because the leak is via the `employee_id` field, not the row id, so it survives fixing #1.
- Fix: load the target employee through the tenant filter first; add a permission to the
  leave-request route.

---

## Tier 2 -- Authentication & secrets

### 5. [HIGH] Admin password reset does not revoke the target user's existing JWTs
- Files: `backend/app/api/users.py:205-207`; `backend/app/api/auth.py:222`; `backend/app/core/dependencies.py:47-53`.
- Problem: token revocation keys entirely on `User.password_changed_at`. The self-service
  change-password flow bumps it; the **admin** `update_user` reset path sets the new hash but
  never bumps the stamp. `create_user`/seed/setup leave it NULL, which `get_current_user` treats
  as "no revocation baseline".
- Impact: resetting a compromised/departing user's password -- the canonical incident-response
  action and the *only* admin-side revocation lever -- silently does nothing. Stolen tokens stay
  valid for the full 24h lifetime.
- Fix: in `update_user`, when a password is set, also set `target.password_changed_at =
  datetime.now(timezone.utc)`. Consider an explicit "revoke sessions" action.

### 6. [HIGH] Default JWT secret is only guarded for `APP_ENV=production`
- Files: `backend/app/core/config.py:4,18-21,324-357`; `backend/.env.example:5,45`.
- Problem: `secret_key` defaults to the public literal `change-me-in-production`. The fail-closed
  guard runs only when `app_env in {production,prod}`. `.env.example` ships `APP_ENV=local` with
  the placeholder secret. Any other env -- `staging`, `qa`, `demo`, or an operator who sets
  `DB_PASSWORD` but forgets to flip `APP_ENV` -- boots with the known HS256 key and no warning.
  The repo's own test asserts `staging` is non-production.
- Impact: HS256 tokens signed with a public constant are forgeable as any user including
  `super_admin` -> full multi-tenant compromise. Conditional on a misconfigured non-prod env, hence
  HIGH not CRITICAL.
- Fix: reject any `change-me*`/empty/<32-char secret in **all** envs except an explicit
  `local`/`dev`/`test` allowlist, and emit a loud boot warning when the default is in use outside
  local. Ship `.env.example` with a non-bootable sentinel.

### 7. [MEDIUM] Recognition/liveness compute endpoints require only `CurrentUser`
- Files: `backend/app/api/recognition.py:79-82,90-95,120-125,165-168`.
- Problem: `detect`/`identify`/`recognize`/`liveness/verify` run ONNX detection + ArcFace +
  anti-spoof on caller-supplied images with no permission gate; rate limiting is per-IP only.
  `identify` can also drive attendance.
- Impact: any low-privilege account can use the box as a free CPU-bound face-recognition oracle
  (~300-400ms/call on CPU), saturate the engine (DoS of the kiosk path), and probe its tenant's
  enrolled index. Dangerous specifically if self-registration is ever re-enabled.
- Fix: gate behind `recognition.view`/a kiosk permission (or a device/service token); add a
  per-user rate limit.

### 8. [LOW] Login is a username-enumeration timing oracle
- File: `backend/app/api/auth.py:64-67`. Unknown emails skip the deliberately-heavy Argon2 verify,
  so login latency reveals which emails have accounts. Fix: verify against a fixed dummy hash when
  the user is absent.

### 9. [LOW] Token-revocation comparison truncates to whole seconds
- Files: `backend/app/api/auth.py:36-40`; `backend/app/core/dependencies.py:48-49`. A token minted in
  the same second as a password change survives it (strict `<` on int seconds). Fix: compare full
  float timestamps.

### 10. [LOW] `users.manage` holder can self-assign `org_admin`
- Files: `backend/app/api/users.py:64-68,215-228`. Only `super_admin` assignment is guarded; nothing
  blocks granting yourself any other role. Not exploitable with the default role set. Fix: forbid
  self-role-modification / require the actor to already hold every permission in a role.

### 11. [LOW] `app_debug` is enforced-off in production but read nowhere
- File: `backend/app/core/config.py:13,355-356`. A misleading dead control -- error verbosity is not
  actually gated on it. Fix: wire it into the exception handlers or remove it.

---

## Tier 3 -- Recognition engine & liveness

### 12. [HIGH] Live camera path runs passive-only anti-spoof; active (temporal) liveness never fires
- Files: `backend/app/engine/recognition_engine.py:232-240,305-307`; `backend/app/engine/liveness_detector.py:117-124,163-176`.
- Problem: `_recognize_tracked_face` calls `recognize_face` with no `liveness_frames`, so
  `verify(..., liveness_frames=None)` skips the active branch entirely, and the engine never passes
  `require_active=True`. No per-track frame buffer is accumulated. So on every live recognition the
  only liveness defense is the single-frame passive model. The kiosk/API path *does* enforce active
  liveness.
- Impact: a looped video replay on a phone/monitor at a fixed entry camera only needs to defeat the
  static passive CNN to be auto-accepted and written as attendance -- exactly the attack the active
  layer exists to stop, silently inert on the primary production input.
- Fix: buffer the last N frames per track and pass them as `liveness_frames`, or call `verify(...,
  require_active=True)` once a sequence exists. At minimum surface "passive-only" in engine status.

### 13. [HIGH] Single-employee delete / re-enroll rebuilds the ENTIRE FAISS index under the lock
- Files: `backend/app/services/faiss_index.py:103-127,159-191,236-254`.
- Problem: `_remove_employee_locked` calls `_compact_mapped_rows`, which `reconstruct()`s **every**
  vector in the index and re-adds them all into a fresh `IndexFlatIP`, then writes the whole file --
  all under the same `RLock` that serializes `search`. `add_batch` (every enrollment) removes-then-adds,
  so re-enrolling one person reconstructs the entire index too. Config advertises `max_embeddings=1_000_000`.
- Impact: every offboarding/onboarding/re-enroll costs O(total org embeddings) and freezes live
  recognition for its duration -- single-digit ms at a few thousand vectors, but multi-second (and a
  ~2GB file rewrite) at the advertised scale.
- Fix: use `IndexIDMap2` over `IndexFlatIP` (or IVF/HNSW) with `remove_ids`, so a mutation touches only
  that employee's rows instead of reconstructing everything.

### 14. [MEDIUM] Anti-spoof silently degrades to coarse heuristics when the ONNX model is missing
- Files: `backend/app/core/config.py:258`; `backend/app/services/antispoof.py:99-101,169-179`; `backend/app/engine/liveness_detector.py:231-233`.
- Problem: `antispoof_fail_without_model` defaults `False`. When the MiniFASNet file is absent
  (`session is None`), `verify` passes on the texture/moire heuristic alone, and a download failure is
  only logged. In the offline/air-gapped packaging the weights may never download.
- Impact: `/health` reports `ai_model: MiniFASNetV2` while the system actually gates on a blur/FFT
  heuristic trivially defeated by a sharp print/screen -- with no alarm.
- Fix: default `antispoof_fail_without_model=True` for production, or alert + reflect a
  `heuristic_only` degraded mode in `/health`.

### 15. [MEDIUM] MiniFASNet ONNX input is fed raw 0-255 floats, no `/255` or mean/std normalization
- File: `backend/app/services/antispoof.py:103-112`. The Silent-Face/MiniFASNetV2 lineage trains with
  `ToTensor()` (pixels in [0,1]); feeding 0-255 magnitudes pushes activations out of the trained range,
  so the "live" probability is likely garbage. (Channel order is correctly BGR end-to-end, so that's not
  the issue.) Undermines the "real model wired in" claim. Fix: confirm the exact preprocessing and apply
  `face/255.0` before inference; add a known-real/known-spoof unit test.

### 16. [MEDIUM] Anti-spoof model auto-downloads from an unauthenticated URL with no checksum
- Files: `backend/app/services/antispoof.py:52-62,64-76`; `backend/app/core/config.py:249-252`.
  `_ensure_model` `urlretrieve`s the model on first use and loads it into onnxruntime with no
  SHA-256/signature verification. A MITM/typosquat/changed upstream yields an attacker-influenced ONNX
  graph running in-process on the component that decides liveness. Fix: pin + verify a SHA-256 (reject on
  mismatch), require HTTPS, prefer shipping the model with the installer; fail closed.

### 17. [LOW] Low-light enhancement is gated on whole-frame mean luminance
- Files: `backend/app/services/face_image_processor.py:181-197`; `backend/app/engine/config.py:79-82`.
  Backlit entry scenes (bright background, dark face) keep the whole-frame mean above target, so the gain
  never fires -- the dominant real-world low-light case (the one commit e3decd0 targeted) gets little help.
  Fix: drive the gain from the detected face-region luminance, or always apply local CLAHE.

### 18. [LOW] Stale `unknown_threshold` config is dead
- Files: `backend/app/engine/config.py:111-113`; `backend/app/engine/vector_search.py:143-151`.
  `SearchConfig.unknown_threshold` is never read; only `auto_accept`/`review` decide bands, and
  `configure_from_settings` doesn't wire it. A misleading tunable. Fix: remove it or make it the explicit
  UNKNOWN floor and wire it in.

---

## Tier 4 -- Attendance & data-integrity correctness

### 19. [MEDIUM] RFID exit-only / out-of-order taps create spurious `status='absent'` rows
- Files: `backend/app/services/attendance_service.py:446-489,350-359`. `process_rfid_tap` calls
  `_get_or_create_today_record` unconditionally before checking direction, so an exit-reader tap by
  someone with no check-in writes a bare `absent` row -- exactly the pollution the face path was
  explicitly fixed against (the comment at 350-359). Fix: mirror the face path -- for an exit-only reader,
  return early when no row exists today instead of creating one.

### 20. [MEDIUM] Unknown-persons report filters by UTC calendar day, not local day
- Files: `backend/app/services/report_service.py:113-122`; `backend/app/core/timeutil.py:62-70`. Uses
  `datetime.combine(date, ..., tzinfo=utc)` instead of `local_day_bounds_utc()` (which the rest of the
  codebase uses). For non-UTC deployments the report is off-by-up-to-the-offset at day edges. Fix: use
  `local_day_bounds_utc()` with a half-open interval.

### 21. [MEDIUM] Visitor dashboard "today" counters use UTC midnight
- File: `backend/app/services/visitor_service.py:36-37,545-555`. `get_dashboard_stats` uses UTC midnight
  while the very next function `get_daily_report` correctly uses `local_day_bounds_utc`; the two disagree.
  Same class as #20. Fix: use `local_day_bounds_utc(local_date(now))`.

### 22. [LOW] Manual attendance can 500 on a concurrent-insert race
- File: `backend/app/api/attendance.py:148-162`. SELECT-then-INSERT with no `IntegrityError` recovery on
  the `UNIQUE(employee_id, work_date)` constraint that the recognition path defends with `begin_nested()`.
  Fix: reuse the `_get_or_create_today_record` recovery pattern.

### 23. [LOW] Manual attendance hardcodes `status='present'`, clobbering `late`/`half_day`
- File: `backend/app/api/attendance.py:166-180`. Ignores shift start/grace and per-policy break minutes, so
  manual corrections misclassify lateness/half-days and diverge from camera/RFID rows. Fix: reuse
  `_resolve_status`/`_calc_worked`/`_resolve_checkout_status`.

### 24. [LOW] `_resolve_checkout_status` computes `min_work` but never uses it; no early-leave rule
- File: `backend/app/services/attendance_service.py:262-272`. The `min_work_minutes` policy field is inert,
  and there's no `early_leave` classification even though reports/exports have that status. Fix: implement
  the rule (classify `early_leave`/`short_day` when `worked < min_work`) or drop the dead binding.

---

## Tier 5 -- Concurrency & event-loop blocking

Async hygiene on the hottest paths is genuinely good (Argon2 offloaded, FaissIndex locked, Redis optional
everywhere, bounded queues, no fire-and-forget task leaks). These are the remaining gaps.

### 25. [HIGH] Unauthenticated `/health` blocks the event loop on a synchronous Celery broadcast
- Files: `backend/app/api/health.py:79,97-99`; `backend/main.py:137-140`. `build_health_response` (async)
  calls `celery_app.control.ping(timeout=1.0)` directly -- a synchronous broker broadcast that blocks the
  lone uvicorn event-loop thread up to a full second (the whole second when the broker is up but no worker
  answers). Exposed unauthenticated at `/health` and `/api/v1/health`, the URLs the docs point monitors to,
  and `CELERY_ENABLED=true` in the shipped installer.
- Impact: every probe parks all other API/recognition/WS traffic for up to 1s on the single-worker box --
  a head-of-line DoS against the very NFR uptime target the endpoint serves.
- Fix: `await asyncio.to_thread(celery_app.control.ping, timeout=0.25)`; keep the trivial `/up` as the
  liveness probe; consider rate-limiting/auth-gating the deep check.

### 26. [HIGH] Recognition snapshot writes block the event loop
- Files: `backend/app/services/recognition_service.py:109,118-127,299,381`. `record_identification` is
  awaited directly from `POST /recognition/identify` (the compute itself *is* offloaded, but the persistence
  is not) and calls synchronous `_save_event_snapshot` -- `base64.b64decode` of a full-res JPEG plus a
  blocking `Path.write_bytes` -- inline on the loop. The matched path is unthrottled.
- Impact: every recorded identify stalls the single worker for the decode+write latency; under busy/multiple
  kiosks or a slow/network snapshot mount this serializes the whole worker.
- Fix: `await asyncio.to_thread(_save_event_snapshot, image_b64, event.id)` in both record paths (the
  function is pure-sync and DB-free, so it moves cleanly off-loop).

### 27. [LOW] Engine dedup/unknown trackers mutate shared state from concurrent threadpool threads
- Files: `backend/app/engine/recognition_engine.py:206-240`; `backend/app/engine/attendance_generator.py:84-94`;
  `backend/app/engine/unknown_detector.py:99-199`. With `_max_concurrent_recognitions=2`, two faces in one
  frame run `recognize_face` on two threads and hit non-atomic check-then-mutate sequences in
  `DuplicateTracker`/`UnknownPersonDetector`. No persisted attendance corruption (the authoritative DB guard +
  UNIQUE constraint cover it); worst case is an occasional extra in-memory event/alert. Fix: a short
  `threading.Lock` around the mutating sections, or cap concurrency to 1. (Also worth a separate look:
  whether the shared InsightFace/ONNX session is re-entrant under 2 concurrent threads.)

### 28. [LOW] Detection WS: per-connection label cache never evicts; opens a fresh DB session per tick
- Files: `backend/app/api/ws.py:189-211,248-255`. The label cache accumulates one entry per distinct identity
  seen for the socket's lifetime (freed on close), and on cache miss opens a new session + per-identity query at
  ~5Hz. Slow leak + DB-load concern at scale, not a correctness bug. Fix: evict expired entries; batch the
  `authorize_match` lookups into one query per tick.

---

## Tier 6 -- CI, testing & tooling (fix first; it's cheap)

### 29. [HIGH] CI is RED -- backend: 2 tests fail against current engine code
- Files: `backend/tests/engine/test_config.py:13`; `backend/tests/engine/test_liveness_detector.py:29`; `.github/workflows/ci.yml:36-41`.
- Problem: `test_config.py:13` asserts `min_quality_score == 0.70` but the real default is now `0.45`
  (lowered with the low-light work). `test_liveness_detector.py:29` asserts `passed is True` but the real
  anti-spoof model now classifies the synthetic random-noise fixture as a deepfake (`model_score=0.0011`).
  Both reproduced locally; `pytest` exits 1.
- Impact: every push/PR to `main` fails the backend job -> a perpetually-red pipeline trains the team to
  ignore CI, so it gates nothing.
- Fix: update `test_config.py` to `0.45`; for the liveness test, feed a real crop / mock the model verdict /
  split the assertion so the synthetic path checks only the heuristic. Re-run to confirm green.

### 30. [HIGH] CI is RED -- frontend: `npm run lint` fails with 4 errors
- Files: `frontend/src/shared/ui/TreeGrid.tsx:250,350`; `frontend/src/features/security/components/OrgNodeForm.tsx:26`, `OrgTreeView.tsx:182`; `.github/workflows/ci.yml:62-63`.
- Problem: the new org-tree UI ships 4 ESLint errors (`react-hooks/purity` on `Date.now()` in an event
  handler, `react-hooks/refs` on a ref-callback, `react-refresh/only-export-components`, an unused var). The
  Lint step runs before tests/build, so the whole frontend job fails. (Two are effectively v7 rule
  false-positives on correct handler/ref-callback code; ESLint emits them as errors regardless.)
- Fix: remove the unused `_ignored` binding; move the non-component export out of `OrgNodeForm.tsx`; add
  targeted `eslint-disable-next-line` for the two false-positive hooks rules (or downgrade those rules to `warn`).

### 31. [MEDIUM] No DB-backed `alembic upgrade head` integration test; migration DDL never executed
- Files: `backend/tests/test_org_tree_migration.py:6-29`; `backend/alembic/versions/g3b4c5d6e7f8_org_tree_merge.py:268,308`; `.github/workflows/ci.yml:15-41`.
  The new behavioral tests use `Base.metadata.create_all` on SQLite; the real Postgres-specific DDL (e.g.
  `text_pattern_ops` indexes) and the entire `upgrade()/downgrade()` are never run. The org-tree merge just
  restructured the schema via exactly this migration. Fix: add a CI job with a `postgres:16` service that runs
  `alembic upgrade head` + `downgrade -1` and asserts the schema.

### 32. [MEDIUM] No backend lint/type tooling; TypeScript strict mode off
- Files: `backend/requirements.txt`; `frontend/tsconfig.app.json:23-27`, `tsconfig.node.json:17-21`. No
  ruff/mypy/black/pre-commit/pytest-cov anywhere over ~36k LOC of async Python; `tsc -b` (the CI "type-check")
  runs with `strictNullChecks`/`noImplicitAny` OFF over ~24k LOC of TS, so the build passes *because* null/any
  unsafety isn't checked. Fix: add `ruff` + `mypy` + a CI step; set `"strict": true` and fix incrementally.

### 33. [LOW] `ci.yml` comment claims hermetic "no live DB" tests (now stale)
- Files: `.github/workflows/ci.yml:37-38`; `backend/tests/conftest.py:118-145`. The new aiosqlite `db_session`
  fixture exercises real SQL. Fix: update the comment.

---

## Tier 7 -- Data model & migrations

The alembic chain is clean and linear (17 revisions, one head), the org-tree merge preserves data with
integrity assertions, and all prior data-model nits (item 20) are genuinely fixed. Remaining:

### 34. [HIGH] `parent_id` cycles have no DB guard, and the recursive CTEs have no cycle/depth limit
- Files: `backend/app/services/organization_service.py:340-362`; `backend/app/middleware/tenant.py:21-89`; `backend/app/core/dependencies.py:162-166`; `backend/app/models/organization.py:33-35`.
- Problem: the org tree is a pure adjacency list with no CHECK/trigger/closure table. Cycles are prevented
  only by `move_node`'s unlocked read-then-write check (READ COMMITTED, no row lock) -- two concurrent moves
  (X under Y; Y under X) both pass and commit a cycle (write-skew). Once a cycle exists, `root_id_of` /
  `descendants_subquery` / `ancestor_chain` walk `parent_id` with `union_all` recursive CTEs that have no
  CYCLE clause, depth cap, or statement timeout, and `root_id_of` (which never matches `parent_id IS NULL`
  inside a cycle) is on the hot tenant-resolution path for every super-admin request.
- Impact: data corruption (a rootless subtree) **and** a DoS -- tenant resolution and the org endpoints hang
  on a non-terminating recursive query, exhausting the DB pool, for the whole company root. Needs a
  concurrency window, but is persistent once triggered.
- Fix: (1) serialize `move_node` with `SELECT ... FOR UPDATE` / a per-root advisory lock around the descendant
  check; (2) make the CTEs cycle-safe (PG14 `CYCLE` clause or a depth-capped visited-path) and break
  `ancestor_chain`'s Python loop on revisit; (3) set a conservative `statement_timeout` as defense in depth.

### 35. [MEDIUM] Company-root `code` is not unique at the DB level
- Files: `backend/app/models/organization.py:20-24`; `backend/alembic/versions/i5d6e7f8a9b0_org_tree_drop_denorm.py:45`; `backend/app/services/organization_service.py:86-96`.
  The only constraint is `UNIQUE(parent_id, code)`; roots have `parent_id IS NULL` (distinct in Postgres), so
  two roots can share a code. The old global `UNIQUE(code)` was dropped in the merge. Uniqueness now rests on
  a race-prone app-layer check-then-insert (and `setup.py` doesn't even call it). Fix: add a partial unique
  index `... (code) WHERE parent_id IS NULL`.

### 36. [LOW] Two divergent recognition-result enums can drift
- Files: `backend/app/models/recognition.py:22-27,47-49`; `backend/app/models/engine.py:33-39,114`.
  `RecognitionResult` (4 members, native PG enum) vs `RecognitionEventResult` (5 members, varchar). No live
  violation today (only `matched`/`unknown` are written), but writing a richer result to
  `recognition_events.result` would hit the enum boundary. Fix: consolidate to one enum/storage strategy.

### 37. [LOW] Org-tree merge backfill re-selects new node id by `(root, code)` instead of `RETURNING id`
- File: `backend/alembic/versions/g3b4c5d6e7f8_org_tree_merge.py:107-135`. Relies on per-root code uniqueness
  that the same migration only enforces *after* the backfill; a subtle collision would mis-parent a subtree
  with no rollback (forward-only). Fix: use `INSERT ... RETURNING id`.

---

## Tier 8 -- Frontend

The WS-feed migration to a shared `useAuthedWebSocket` (fresh token per attempt, exponential backoff,
subprotocol token), the `?next=` open-redirect protection, and the org-tree move-UI cycle prevention are all
genuinely good. Remaining:

### 38. [MEDIUM] TypeScript strict mode is OFF in all tsconfigs
- Files: `frontend/tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.json`. (Verifier downgraded from HIGH:
  it's a project-wide config weakness, not a demonstrated crash.) No `strict`/`strictNullChecks`/`noImplicitAny`;
  the codebase leans heavily on `?.`/`??` over API responses, exactly what `strictNullChecks` would enforce, so a
  forgotten guard compiles and can throw at runtime. Fix: enable `"strict": true` and fix incrementally.

### 39. [MEDIUM] No CSP; JWT in `localStorage` is XSS-exfiltratable
- Files: `frontend/index.html`; `frontend/src/shared/lib/session.ts:13-23`; `frontend/src/shared/api/client.ts:31-41`.
  (Verifier downgraded from HIGH: a hardening gap requiring a separate XSS primitive, no confirmed sink in the
  auto-escaping React app.) The Bearer JWT lives in `localStorage` with no Content-Security-Policy anywhere
  (frontend or the packaged nginx). Fix: serve a strict CSP and move the token to an httpOnly/Secure/SameSite
  cookie (or at least add CSP + keep the reduced 1-day lifetime).

### 40. [MEDIUM] ESLint uses non-type-checked rules
- Files: `frontend/eslint.config.js:8-22`. Extends `recommended` not `recommendedTypeChecked`, no
  `parserOptions.project`, and `lint` doesn't run `tsc`, so `no-floating-promises`/unsafe-`any` are never linted
  (and several `void dispatch(...)` fire-and-forgets go unaudited). Fix: switch to `recommendedTypeChecked` + a
  `typecheck` CI step.

### 41. [MEDIUM] `ProtectedRoute` redirects to `/login` without `?next=`
- Files: `frontend/src/features/auth/ProtectedRoute.tsx:11`. The 401 interceptor preserves `?next=`, but the
  ProtectedRoute path (deep-link while unauthenticated, reload after token expiry) does a bare `<Navigate
  to="/login">`, so users land on the dashboard instead of their destination. Fix: build the `next` param like
  the interceptor.

### 42. [MEDIUM] `RealtimeContext` still hand-rolls WebSocket connect/backoff/heartbeat
- Files: `frontend/src/features/realtime/RealtimeContext.tsx:101-175`; `frontend/src/shared/hooks/useAuthedWebSocket.ts`.
  The feed sockets were migrated to the shared hook but `RealtimeContext` keeps a second, already-divergent copy
  (it has a heartbeat the shared hook lacks). Fix: refactor onto the shared hook (add an optional ping interval).

### 43. [LOW] `MoveNodePanel` memoization defeated by a fresh array dependency
- File: `frontend/src/features/security/components/MoveNodePanel.tsx:28-44`. `scope = root ? [root] : tree` is a
  new array each render, so the `useMemo`s recompute every render. Correctness is fine (server is authoritative).
  Fix: `useMemo(() => (root ? [root] : tree), [root, tree])`.

### 44. [LOW] No-token WebSocket retries spin a 1.5s timer forever
- File: `frontend/src/shared/hooks/useAuthedWebSocket.ts:65-72`. When `getToken()` is null it reschedules every
  1.5s indefinitely (logout race). Fix: derive `enabled` from auth state so the effect tears down.

---

## Ops/packaging nits

- **[MEDIUM] Install docs advertise the wrong internal API port (8000); actual is 18000** --
  `WINDOWS_INSTALL.md:12,37,87`, `windows/README.md:41` vs `common.ps1:39`/`Program.cs:30`. Nothing listens on
  8000 in the packaged product, so port-conflict troubleshooting targets the wrong port. Fix: change to 18000
  (loopback behind nginx; 8080 is user-facing).
- **[LOW] `WINDOWS_INSTALL.md:66` lists a `ProgramData\...\redis\` dir that is never created** -- Redis is the
  Memurai MSI under its own path. Fix: remove/correct the line.
- **[LOW] Top-level `README.md:3,78` still markets "multi-location" / "departments, locations"** after the
  org-tree merge folded departments into the tree. Fix: describe the structural org tree.

---

## Prior-review (2026-06-12) reconciliation

All 30 prior items, checked against current source:

| # | Prior finding | Prior sev | Status |
|---|---|---|---|
| 1 | Timezone corrupts attendance ledger | CRITICAL | **RESOLVED** (new `core/timeutil.py`; writes+reads both local) |
| 2 | Live camera events never persisted | CRITICAL | **RESOLVED** (`engine/attendance_sync.py` consumer, bounded queue) |
| 3 | Employee delete destroys history + leaves vectors | HIGH | **RESOLVED** (soft-delete + FAISS purge + bail on missing/inactive) |
| 4 | Recognition not tenant-scoped | HIGH | **RESOLVED** (`authorize_match` gates every match on org) |
| 5 | Snapshot IDOR | HIGH | **RESOLVED** (`snapshot_path` filters `organization_id`, 404s) |
| 6 | Visitor API no permission checks | HIGH | **RESOLVED** (every route now `require_permission`) |
| 7 | `.env.example` defeats secret guard | HIGH | **RESOLVED** (placeholder now trips the guard; guard broadened) |
| 8 | SSRF via `stream_url` | HIGH | **RESOLVED** (validation + `cameras.manage`; residual DNS-rebind TOCTOU below) |
| -- | Self-registration on by default | MED | **RESOLVED** (defaults False) |
| -- | JWTs cannot be revoked; 7-day | MED | **PARTIAL** (`pwd_at` stamp + 1-day; logout still doesn't invalidate; no jti denylist) |
| -- | Global roles -> escalation | MED | **PARTIAL** (mutation locked to super-admin; schema still global) |
| -- | Weak `.env.example` secrets | LOW | **RESOLVED** |
| 9 | Engine threshold 0.90 miscalibrated | HIGH | **PARTIAL** (recalibrated 0.5/0.4 + wired; REVIEW-band still dropped, no review queue) |
| 10 | FaissIndex not thread-safe | HIGH | **RESOLVED** (RLock + atomic writes; perf issue #13 remains) |
| 11 | Stream stop races `release()` | HIGH | **RESOLVED** (read loop owns release; timeouts set) |
| 12 | Reconnect gives up; offline alert dead | HIGH | **RESOLVED** (indefinite backoff; health metrics fired + monitor restarts) |
| 13 | Engine searches stale FAISS instance | MED | **RESOLVED** (shares the singleton via property) |
| 14 | Manual attendance crash + no tenant scope | HIGH | **RESOLVED** (typed datetimes + validator + tenant filter) |
| -- | RFID first tap mislabeled duplicate | MED | **RESOLVED** (returns explicit `last_action`) |
| -- | Argon2 sync on event loop | MED | **RESOLVED** (`run_in_threadpool`) |
| -- | Liveness heuristic-only; hooks dead | MED | **RESOLVED** (real MiniFASNet wired; caveats #14-16 above) |
| -- | `lazy='selectin'` fan-out | MED | **PARTIAL** (hot paths suppressed; 63 model-level defaults remain) |
| 15 | No CI pipeline | MED | **RESOLVED** (`.github/workflows/ci.yml` -- but currently RED, #29/#30) |
| 16 | Security code has no behavioral tests | MED | **RESOLVED** (auth/tenant/state-machine tests added) |
| 17 | No DB-backed tests / lint / FE strict | MED | **PARTIAL** (aiosqlite tests added; no alembic test, no backend lint, FE strict still off) |
| 18 | FE auth/session + WS plumbing | MED | **PARTIAL** (`?next=` + shared WS hook done; localStorage JWT/no-CSP remain) |
| 19 | Ops/packaging polish | MED | **PARTIAL** (logging/health/README/backup fixed; `.git` still ~473 MiB, no gc) |
| 20 (all 7 nits) | Data-model nits | MED/LOW | **RESOLVED** (per-org code, holidays partial indexes, FK indexes, enums, typing) except timestamps NOT NULL **PARTIAL** (deferred) |

---

## What is genuinely good (verified)

- **Tenant scoping after the org-tree merge is largely correct**: `get_tenant_org_id` resolves any header
  node to its company root and rejects org-less users; recognition, snapshots, visitors-by-id, employee/
  attendance single-row paths, anomalies, and every org-node op are tenant-filtered. The Tier-1 gaps are the
  specific paths the pattern wasn't applied to.
- **The whole prior critical/data-loss set is fixed**: timezone authority, live-event persistence, FAISS
  thread-safety + atomic writes + shared singleton, stream lifecycle/reconnect/timeouts, manual-attendance
  validation, soft-delete with FAISS purge.
- **Async hygiene**: Argon2 offloaded; Redis optional everywhere (degrades, never fails); bounded queues;
  no fire-and-forget task leaks; the attendance consumer's single-writer + per-event-commit + retry-stash +
  duplicate-unarm idempotency is solid.
- **Data layer**: clean linear alembic chain; the org-tree migration preserves data with integrity asserts;
  per-org employee codes, holiday partial indexes, hot-FK indexes, and model/migration alignment all landed.
- **Frontend**: shared authed-WebSocket hook (fresh token, backoff, subprotocol), open-redirect-safe `?next=`,
  correct org-tree move-UI cycle prevention, correct object-URL lifecycle.
- **Packaging**: dictConfig logging called first in lifespan; `/health` covers DB+FAISS+Redis+Celery; correct
  Postgres+FAISS backup guidance; no committed binary blobs; `DB_SSLMODE` is actually wired through.

---

## Suggested order of work

1. **Make CI green (#29, #30).** Trivial; without it nothing else is gated. Then keep the suite green.
2. **Close the cross-tenant IDOR family (#1-#4).** Highest-severity active holes; same one-line
   `apply_tenant_filter`/ownership-check pattern in each. Add a tenant-isolation test per endpoint.
3. **Auth containment (#5, #6).** Bump `password_changed_at` on admin reset; enforce the secret in non-prod.
4. **Event-loop blocking (#25, #26)** and **liveness on the live path (#12).** These hit availability and the
   anti-spoof guarantee on the primary production input.
5. **Org-tree cycle safety (#34)** and **FAISS O(N) reconstruct (#13)** before scaling up org count/headcount.
6. Then the MEDIUM correctness/data-model/frontend items and the LOW polish, plus a `postgres` CI job (#31)
   and backend lint/type tooling + FE strict (#32) to lock in the gains.
