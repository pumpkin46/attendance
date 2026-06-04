# Project conventions

AI attendance & access-control platform. **Backend:** FastAPI + SQLAlchemy 2.0
(async) + asyncpg + Pydantic v2. **Frontend:** React 19 + TypeScript + Vite +
TanStack Query + Tailwind. **ML:** InsightFace + FAISS + ONNX (see
[backend/app/engine/README.md](backend/app/engine/README.md)).

A consistency redesign is underway; see
[docs/architecture-redesign.md](docs/architecture-redesign.md). New code must
follow the conventions below — do not reintroduce the legacy patterns.

## Backend

- **Thin routes, fat services.** Route handlers in `routes.py` validate input,
  call a service, and return a typed model. **No `db.execute` / `select(...)` or
  business branching in route handlers** — that lives in `service.py`.
- **All handlers are `async`.** CPU-bound ML calls (sync `face_service.*`,
  InsightFace, FAISS) must be wrapped: `await run_in_threadpool(fn, ...)`. Never
  call blocking work directly inside `async def`.
- **Typed responses everywhere.** Every route declares `response_model=`. List
  endpoints return `PaginatedResponse[XxxOut]` (via `core.pagination.paginate`).
  Detail endpoints return a Pydantic `XxxOut`. DELETE returns `204 No Content`.
- **Errors.** Raise typed errors from `app.core.errors`
  (`NotFoundError`, `PermissionDeniedError`, `ConflictError`, `ValidationError`).
  Do **not** hand-build `HTTPException` in new code. The global handlers in
  `app.core.errors.register_exception_handlers` render the single envelope
  `{"error": {"code", "message", "details"}}`.
- **Dependencies.** Use the typed deps from `app.core.dependencies`:
  `CurrentUser`, `DbSession`, `TenantOrgId`, and `require_permission("x.y")`.
- **Routers.** One router per feature owning its full prefix
  (`APIRouter(prefix="/api/v1/<feature>", tags=["<feature>"])`); decorators use
  relative paths. No `_api` suffix on module names.

## Frontend

- **Data fetching = TanStack Query only.** Never `useEffect` + `axios` +
  `useState` fetch loops. Reads use `useApiQuery`; writes use `useMutation`.
  Inline in the page is fine for simple cases (see `EmployeesPage`); extract a
  feature `queries.ts` when hooks are shared across components (see `visitors/`,
  `cameras/` — the template). The only place `axios`/`api` is acceptable is the
  `mutationFn` of a `useMutation` (or inside `queries.ts`), or a genuinely
  imperative real-time loop (e.g. the kiosk recognition poll) and binary
  downloads (CSV export). Never for ordinary GET data.
- **Mutations** invalidate the relevant query key (a feature
  `useInvalidateXxx()` when one exists) and surface success via `sonner` toasts;
  errors read through `getApiErrorMessage`.
- **Types** live in the feature's `types.ts`; only cross-feature types go in
  `src/types`. They mirror the backend `XxxOut` schemas.
- **Session state** (auth token, tenant org id) goes through `src/lib/session.ts`
  only — never raw `localStorage`.

## Verify before done

- Backend: `python -c "import main"` (catches import/wiring breakage) and
  `pytest` from `backend/`.
- Frontend: `npx tsc -b` and `npm test` (Vitest) from `frontend/`.
