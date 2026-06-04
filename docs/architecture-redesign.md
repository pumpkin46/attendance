# Architecture Redesign Plan

**Status:** Proposal — awaiting approval before implementation
**Date:** 2026-06-04
**Driver:** Maintainability & consistency (reduce tech debt, standardize patterns)
**Scope:** Whole codebase (backend FastAPI + frontend React/TS)
**Constraint posture:** Breaking changes permitted (internal contracts, folder layout, API/DB schemas) where they improve the design.

---

## 1. Executive Summary

The system is **not architecturally broken** — it has clean layering, dependency injection, multi-tenancy, RBAC, a dedicated ML engine, React Query, and tests on both sides. The real problem is **inconsistency**: the codebase is mid-migration, and several good patterns coexist with the older patterns they were meant to replace.

The single most important observation:

> **The `visitors` module — both backend (`app/api/visitors.py` + `visitor_service.py`) and frontend (`pages/visitors/` with `queries.ts` + `types.ts`) — is the most recently refactored code and already demonstrates the target architecture.** This plan is largely about **propagating the visitors-module pattern to the rest of the codebase**, plus a few cross-cutting standards.

This means "best practices" here is not a speculative rewrite. It is **convergence on patterns the team has already chosen and validated**.

### Top problems, ranked by impact on maintainability

| # | Problem | Where | Severity |
|---|---------|-------|----------|
| 1 | Frontend data-fetching split ~50/50 between React Query and `useEffect`+`axios`+`useState` | ~8 pages each way | **Critical** |
| 2 | API responses inconsistent: ~46% use `response_model`, ~54% return bare dicts/lists; pagination returns an untyped dict | backend `app/api/*` | **High** |
| 3 | No per-domain frontend API/query layer outside `visitors` — components call `api.*` inline | most pages | **High** |
| 4 | Folder structure is type-first everywhere except `visitors` (feature-first) | frontend | **High** |
| 5 | Sync route handlers in `routes.py` block the event loop; everything else is async | `app/api/routes.py` | **High** |
| 6 | No global exception handler; error payload shapes & `HTTPException` call styles vary | backend | **Medium** |
| 7 | "Fat" API modules with inline business logic + DB queries | `visitors.py` (750+), `monitoring.py`, `reports.py` | **Medium** |
| 8 | Monolithic page components (400+ lines), local type duplication | frontend pages | **Medium** |
| 9 | Inconsistent router naming (`_api` suffix on 2/24), prefixes, DELETE responses | backend | **Low** |
| 10 | Single flat 235-line `Settings` class; `localStorage` accessed in 5 scattered places | both | **Low** |

---

## 2. Guiding Principles

1. **One way to do each thing.** Where two patterns exist, pick the better one (almost always the newer `visitors` pattern) and migrate the rest. Delete the old way.
2. **Feature-first organization.** Code that changes together lives together. A feature owns its routes, service, schemas (backend) / queries, types, components (frontend).
3. **Thin transport, fat services.** API route handlers parse input, call a service, shape output. Business logic and DB access live in the service layer.
4. **Typed contracts at every boundary.** Every endpoint declares a `response_model`; every list endpoint returns a typed envelope; the frontend mirrors those types.
5. **Standardize the cross-cutting envelope.** One pagination shape, one error shape, one global exception handler.
6. **Incremental & reviewable.** Even with "anything goes," migrate one feature slice at a time so each PR is reviewable and the app stays green.

---

## 3. Target Architecture — Backend

### 3.1 Feature-first package layout

Today the backend is layer-first (`api/`, `services/`, `schemas/`, `models/` each holding ~20 files). For a domain this wide (attendance, recognition, visitors, rfid, cameras, anomalies, security, building, shifts, reports, audit, privacy, access, org), feature-first scales better.

**Proposed:**

```
backend/app/
  core/                      # infra only: config, security, db, deps, pagination, rate_limit, errors
  features/
    auth/         routes.py  service.py  schemas.py  models.py
    employees/    routes.py  service.py  schemas.py  models.py
    attendance/   routes.py  service.py  schemas.py  models.py
    recognition/  routes.py  service.py  schemas.py  models.py
    enrollment/   routes.py  service.py  schemas.py  models.py
    visitors/     routes.py  service.py  schemas.py  models.py   # already close to this
    rfid/         ...
    cameras/      ...
    anomalies/    ...
    shifts/       ...
    security/     ...
    building/     ...
    reports/      ...
    audit/        ...
    privacy/      ...
    access/       ...
    organizations/ ...
  engine/                    # ML stream pipeline stays separate (distinct lifecycle) — keep, document boundary
  realtime/                  # pub/sub hub — keep
  main.py                    # app factory + router auto-registration
```

> **Note on `engine/` vs `services/`.** The split is legitimate (single-image services vs. continuous stream pipeline) but **undocumented**, which invites accidental duplication (`face_quality.py` vs `quality_assessor.py`, `liveness.py` vs `liveness_detector.py`). Action: add `backend/app/engine/README.md` stating the boundary — `features/*/service.py` = request-scoped recognition; `engine/` = long-running per-camera pipeline; shared low-level primitives (detector, embedder, FAISS) live in one place and are imported by both. Eliminate any true duplication, keep intentional separation.

If a full move is too disruptive in one pass, an acceptable interim is keeping the layer-first folders but enforcing the *rules* below; the folder move can be a later phase. **Recommended: do the move per-feature as each feature is standardized** so it happens once.

### 3.2 Standard response envelope

Create `core/schemas.py`:

```python
class Page(BaseModel, Generic[T]):
    data: list[T]
    total: int
    page: int
    per_page: int
    last_page: int
```

- `core/pagination.py::paginate()` returns `Page[T]` instead of a raw dict (the root cause of the 54% untyped responses).
- **Every** route declares `response_model` — list endpoints use `Page[XxxOut]`, detail endpoints use `XxxOut`.
- DELETE: standardize on `204 No Content` (drop the ad-hoc `{"message": "..."}` dicts in `shifts.py` etc.).

### 3.3 Standard error envelope + global handlers

Create `core/errors.py` with a small exception hierarchy (`AppError` → `NotFoundError`, `PermissionError`, `ValidationError`, `ConflictError`) and register global handlers in `main.py`:

```json
{ "error": { "code": "not_found", "message": "Shift not found", "details": {} } }
```

- Services raise typed `AppError`s; handlers translate to HTTP. Route handlers stop hand-writing `HTTPException(404, "...")`.
- Standardize remaining `HTTPException` uses on keyword args + `status.HTTP_*` constants (lint rule / review checklist).

### 3.4 Thin routes, fat services (enforced)

- **Rule:** no `db.execute`/`select(...)` or business branching inside `app/features/*/routes.py`. All of it moves to `service.py`.
- Refactor the "fat" modules first: `visitors.py` (750+ lines → already has a service, push the rest down), `reports.py`, `monitoring.py`, the inline logic in `recognition_api.py::identify_face` (~94 lines) and `attendance.py` manual record creation.
- Routes become: validate (Pydantic) → `result = await service.x(...)` → return typed model.

### 3.5 Fix async/sync correctness

- `app/api/routes.py` has ~12 **sync** `def` handlers calling sync face-service functions. Convert to `async def`; run CPU-bound ML work via `await run_in_threadpool(...)` (or `asyncio.to_thread`) so the event loop is never blocked. This is a **correctness** fix, not just style.
- Audit every handler that calls `face_service.*` (sync) from an `async def` — wrap those calls in a threadpool too.

### 3.6 Config grouping

Split the flat 235-line `Settings` into nested Pydantic models with env nesting, preserving env-var names via `env=`/aliases:

```python
class Settings(BaseSettings):
    app: AppSettings
    db: DatabaseSettings
    auth: AuthSettings
    rate_limit: RateLimitSettings
    attendance: AttendanceSettings
    recognition: RecognitionSettings
    engine: EngineSettings
    ...
```

Lower priority (cosmetic), but high readability payoff and a natural home for the engine settings currently mixed into core config.

### 3.7 Naming & registration cleanup

- Drop the `_api` suffix: `recognition_api.py` → `recognition/routes.py`, `engine_api.py` → `engine` routes. Consistent module naming.
- Each router owns its **full** prefix (`prefix="/api/v1/shifts"`) and a single `tags=[...]`; route decorators use relative paths. Removes the `prefix="/api/v1"` + `@router.get("/shifts")` split that makes routes hard to grep.
- `main.py` auto-discovers and includes `features/*/routes.py::router` to remove the 24-line manual include list and its drift.

---

## 4. Target Architecture — Frontend

### 4.1 The `visitors` module is the template

`pages/visitors/` already has the shape every feature should have:

```
pages/visitors/
  queries.ts     # all useQuery/useMutation hooks + centralized cache invalidation
  types.ts       # feature domain types + constants
  VisitorsPage.tsx        # container
  AllVisitorsTab.tsx ...  # focused child components
```

**Adopt this everywhere.** Target structure:

```
frontend/src/
  app/                 # App.tsx, router, providers
  shared/
    api/client.ts      # axios instance (keep)
    ui/                # Button, Card, DataTable, Skeleton, ... (keep)
    hooks/             # useApiQuery, useWebcam (cross-feature only)
    lib/               # cn, queryClient, inputClass
    types/             # only truly cross-feature types
  features/
    auth/        queries.ts  types.ts  AuthContext.tsx  components/
    cameras/     queries.ts  types.ts  CamerasPage.tsx  components/
    rfid/        queries.ts  types.ts  RfidPage.tsx     components/
    enrollment/  queries.ts  types.ts  EnrollmentPage.tsx FaceCaptureModal.tsx
    reports/     queries.ts  types.ts  ReportsPage.tsx
    visitors/    (already here)
    ... (one folder per feature)
```

This also rehomes misplaced shared components: `VisitorDetailPanel.tsx` → `features/visitors/`, `FaceCaptureModal.tsx` → `features/enrollment/`.

### 4.2 One data-fetching pattern: React Query everywhere

**The critical fix.** Migrate the 8 `useEffect`+`axios`+`useState` pages to React Query via per-feature `queries.ts`:

- `CamerasPage` (446 lines), `AccessControlPage`, `EnrollmentPage`, `LiveKioskPage`, `LivenessTestPage`, `SecurityTenancyPage`, `ShiftsPage`, `SmartBuildingPage`.
- Each gets a `queries.ts` exporting typed hooks (`useCamerasList()`, `useCreateCamera()`, ...) using `useQuery`/`useMutation` + `useQueryClient` invalidation — exactly like `visitors/queries.ts`.
- Remove manual `load()`/refetch-after-mutate patterns; rely on query invalidation.
- Components stop importing the `api` client directly; they import feature hooks. (The `api` client is then only referenced inside `queries.ts` files.)

### 4.3 Types: one source per feature

- Move page-local interfaces (`Location`, `CameraConfig`, `DailyReport`, `AccessPoint`, ...) into the feature's `types.ts`.
- Keep `shared/types` for genuinely cross-feature types (`User`, `Paginated<T>`, `Role`, `Permission`).
- These should mirror the backend `XxxOut` schemas; a later optional phase can auto-generate them from the OpenAPI schema to eliminate hand-maintenance drift.

### 4.4 Consistent loading & error UX

- Standardize on `useQuery`'s `isPending`/`isError` + a shared `<QueryBoundary>` / `<Skeleton>` so every page shows loading and error states the same way (several old pages currently show neither — e.g. `CamerasPage`'s `loading` flag is never set).
- All mutation errors surface via the existing `sonner` toast + `getApiErrorMessage()` helper, applied uniformly.

### 4.5 Centralize `localStorage` / session state

`localStorage` for `auth_token` and `tenant_organization_id` is read/written in 5 places (`api/client.ts`, `AuthContext`, `RealtimeContext`, `SecurityTenancyPage`). Wrap in a single `shared/lib/session.ts` (`getToken`/`setToken`/`getOrgId`/...) and optionally a `storage` event listener for cross-tab logout sync. Everything else goes through it.

### 4.6 Optional: lightweight form handling

Forms are hand-rolled `useState` blobs (e.g. visitor registration with 20+ fields). Not urgent, but adopting `react-hook-form` (+ optional `zod`) for the larger forms would cut boilerplate and unify validation. Low priority.

---

## 5. Cross-Cutting Standards (apply during migration)

| Concern | Standard |
|---------|----------|
| Pagination | Backend `Page[T]`; frontend `Paginated<T>` mirrors it exactly |
| Errors | Backend `{error:{code,message,details}}` via global handler; frontend `getApiErrorMessage()` + toast |
| Auth/tenancy | Backend `CurrentUser`/`DbSession`/`TenantOrgId` deps (already consistent — keep); frontend `session.ts` |
| Routes | full prefix per router, no `_api` suffix, relative decorator paths, `response_model` always |
| Services | all DB + business logic; routes never touch the DB directly |
| Async | every handler `async`; CPU/ML work via threadpool |
| Naming | `feature/routes.py|service.py|schemas.py|models.py`; frontend `feature/queries.ts|types.ts` |

---

## 6. Phased Roadmap

Each phase is independently shippable and leaves the app green. Phases 1–2 deliver most of the maintainability value.

### Phase 0 — Foundations (no behavior change)
- Add `core/schemas.py` (`Page[T]`), `core/errors.py` (exception hierarchy + global handlers), frontend `shared/lib/session.ts`.
- Document the `engine/` vs `service/` boundary.
- Write this doc's conventions into `CLAUDE.md` so new code follows them immediately.

### Phase 1 — Frontend data-fetching convergence (highest ROI)
- Migrate the 8 legacy pages to per-feature `queries.ts` + React Query, one feature per PR, using `visitors/` as the template.
- Rehome page-local types into `feature/types.ts`; standardize loading/error UX.
- Outcome: a single, predictable data layer across the whole UI.

### Phase 2 — Backend response/error standardization
- Switch `paginate()` to return `Page[T]`; add `response_model` to all ~96 endpoints missing it.
- Land global exception handlers; convert ad-hoc `HTTPException`/`{"message":...}`/bare-dict responses.
- Standardize DELETE → 204.

### Phase 3 — Backend thin-routes refactor + async fix
- Convert `routes.py` sync handlers to async + threadpool; audit other sync-in-async calls.
- Push inline logic from `visitors.py`, `reports.py`, `monitoring.py`, `recognition` into their services.

### Phase 4 — Feature-first folder moves
- Reorganize backend into `app/features/*` and frontend into `src/features/*`, one feature at a time. (Can be interleaved with Phases 1–3 so each feature is moved as it's standardized.)
- Router auto-registration; drop `_api` naming; fix prefixes.

### Phase 5 — Config & polish
- Nest `Settings` into grouped models.
- Optional: OpenAPI→TS type generation; `react-hook-form` for large forms.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Big-bang folder move breaks imports | Move per-feature; rely on tests + typecheck (`tsc -b`, `pytest`) per PR |
| Response-shape changes break the frontend | Frontend types are migrated in the same/adjacent PR; `Page[T]` keeps the same JSON keys (`data,total,page,per_page,last_page`) already used by `paginate()` |
| Async conversion changes timing/behavior | Threadpool-wrap is behavior-preserving; cover recognition/enroll paths with the existing tests before/after |
| Scope creep into ML/engine internals | Out of scope here — engine internals unchanged; only the documented boundary + naming |
| Thin test coverage (3 FE / 5 BE files) | Add a smoke test per migrated feature as part of its PR; this is the natural time to grow coverage |

---

## 8. Out of Scope (explicitly)

These are real (from the earlier audit) but are **scalability/observability** concerns, not maintainability/consistency — track separately:

- Redis-backed realtime hub & rate limiter (multi-worker scaling)
- Engine process isolation / graceful shutdown
- Structured logging, Prometheus `/metrics`, tracing
- WebSocket auto-reconnect, model registry/versioning, E2E tests, zero-downtime migrations

---

## 9. Decision Needed

To proceed, confirm:
1. **Approve the feature-first target layout** (Section 3.1 / 4.1), or prefer keeping layer-first and enforcing only the rules?
2. **Approve Phase ordering** (frontend data-fetching first), or a different priority?
3. **Green light to begin Phase 0 + Phase 1**, one PR per feature?
