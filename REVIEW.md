# Code Review — uncommitted working-tree changes

**Date:** 2026-06-11
**Scope:** `git diff HEAD` (~2,300 lines) + 6 untracked files. Change set covers: notifications feature removal (backend model/API/schema/migration + frontend pages), new report export service (CSV/Excel/PDF via openpyxl/reportlab), frontend query refactors across all features, and a new viewport-lazy SnapshotImage with blob caching.
**Method:** 7 independent finder angles, each candidate independently verified (CONFIRMED / PLAUSIBLE / REFUTED). Findings ranked most severe first.

---

## 1. [CONFIRMED] `useApiQuery` clobbers the global 30s staleTime — app-wide refetch storm

**File:** `frontend/src/shared/hooks/useApiQuery.ts:46`

The hook now passes `staleTime: options.staleTime` unconditionally. For the ~25 of 39 call sites that omit `staleTime`, this creates an own key with value `undefined`, and TanStack Query v5's `defaultQueryOptions` merges via plain object spread (`{...defaultOptions.queries, ...options}`) — spread copies own `undefined` keys, so the global `staleTime: 30_000` in `shared/lib/queryClient.ts:25` is overridden to `undefined`, which `isStaleByTime` treats as `0`.

**Impact:** every query without an explicit staleTime is always stale — every page navigation refetches every query on mount instead of serving from cache for 30s. Silently reverts the intended app-wide caching default.

**Fix:** only include the key when defined, e.g. `...(options.staleTime !== undefined && { staleTime: options.staleTime })`, or pass the whole options object through without enumerating keys.

## 2. [CONFIRMED] Load-test assets still reference the deleted notifications feature

**Files:** `backend/seed_loadtest.py:48`, `loadtest/k6/api-slo.js:34,49`, `loadtest/README.md:39-43`, `backend/CELERY.md:42`

`seed_loadtest.py` still does `from app.models.notification import Notification` (line 48) and purges/seeds notification rows (lines 92, 382-400). The model file is deleted, so the seeder dies with `ImportError` on launch; even with the import removed, migration `a7b8c9d0e1f2` drops the table it inserts into. The k6 SLO suite still has a `notifications` scenario hitting `/api/v1/notifications?per_page=50` with a p95<200ms threshold — it will measure 404s.

**Fix:** delete the notifications sections from the seeder, the k6 scenario + threshold, and the doc mentions, in the same commit as the feature removal.

## 3. [CONFIRMED] `GET /reports/export` silently breaks the old API contract

**File:** `backend/app/api/reports.py:90-140`, `backend/app/services/report_export.py`

The old endpoint accepted `?start=...&end=...` (and `date`). The new signature has no `start`/`end` — FastAPI silently ignores unknown query params, so a legacy call returns **HTTP 200 with today's daily report** instead of the requested range. No error signals the break. Additionally:

- `tz_offset` defaults to `0`, so any API client that omits it gets UTC wall-clock times rendered as if local (a 09:00+05:00 check-in exports as "04:00").
- The new attendance export drops the `Method In`/`Method Out` columns (`check_in_method`/`check_out_method`) entirely — that data is no longer available in any export format — and replaces ISO-8601 timestamps with `HH:MM` strings, breaking downstream parsers.

The in-repo frontend was updated in the same diff, so this affects only external/scripted consumers — but the failure mode is silent wrong data, not an error.

**Fix:** either keep accepting `start`/`end` as deprecated aliases for `date_from`/`date_to` (with `report_type` inferred), or reject unknown legacy params explicitly (422) so old callers fail loudly. Consider keeping method columns in the CSV (machine-readable format).

## 4. [CONFIRMED] UnknownFacesPage: server-side pagination under client-side filters and stats

**File:** `frontend/src/features/recognition/UnknownFacesPage.tsx:73-118`

The query now fetches 24 rows/page server-side, but the camera/alerts filters, the four stat cards, and the camera dropdown all still compute from the current page's rows:

- Stat cards show per-page counts (`total: filtered.length` at line 97) instead of `data.total` — "Flagged faces" shows 24 for a 60-event range and changes as the user pages.
- `cameraOptions` derives from the current page, so a camera whose events are all on other pages never appears in the dropdown.
- Filters apply locally while the Pagination footer shows the unfiltered server total — a filtered page can read "No unknown faces match" next to "Showing 1-24 of 60".

**Fix:** push camera/alerts filters into API query params (the pagination layer), and compute stat cards from server totals (`data.total` or a small stats endpoint).

## 5. [CONFIRMED] `useDeleteEmployee` decrements `total` on cached lists that don't contain the deleted row

**File:** `frontend/src/features/employees/api/queries.ts:72-74`

`setQueriesData` matches the bare `['employees']` prefix and unconditionally applies `total: old.total - 1` — including search-list variants kept by `keepPreviousData`, `['employees','active']` (when deleting an inactive employee), and visitors' `['employees','options']`. Lists whose `data.filter` removed nothing still lose 1 from `total`, so result counts and pagination drift by one per delete until a refetch.

**Fix:** only decrement when the filter actually removed a row: `const data = old.data.filter(...); return { ...old, data, total: old.total - (old.data.length - data.length) }`. (Same pattern applies to the copies in cameras/building/visitors — see finding 9.)

## 6. [CONFIRMED] Export buttons rendered without the `reports.export` permission gate

**Files:** `frontend/src/features/reports/components/ExportButtons.tsx`, `frontend/src/features/attendance/AttendancePage.tsx`, `frontend/src/features/reports/ReportsPage.tsx`

The backend gates `GET /reports/export` with `require_permission("reports.export")` (`reports.py:93`), but `ExportButtons` renders unconditionally. `/attendance` is reachable by any authenticated user (absent from `ROUTE_PERMISSIONS` in `app/access.ts`), and seeded roles exist with `reports.view` but not `reports.export` — those users see enabled CSV/Excel/PDF buttons that always 403 into an "Export failed" toast. The codebase's stated convention (access.ts: guards "hide exactly what the API would reject with 403"; `UserManagementPage` gates its Roles tab on `hasPermission('roles.manage')`) is to hide ungranted actions.

**Fix:** wrap the buttons in `hasPermission('reports.export')`.

## 7. [CONFIRMED] Synchronous PDF/Excel rendering blocks the event loop; reportlab/openpyxl imported at startup

**Files:** `backend/app/api/reports.py:119,127,133`, `backend/app/services/report_export.py:26-37`

`report_export.export_daily/export_attendance/export_monthly` are pure-sync CPU-bound renderers called directly inside `async def export_report`. A monthly PDF/Excel for a large org takes hundreds of ms to seconds of CPU, during which the entire FastAPI event loop is frozen — all concurrent requests stall. Also, `report_export.py` imports openpyxl + reportlab at module top and is imported by `app.api.reports` at startup, so every process pays the import cost even if no export ever runs. Related: `attendance_range_report` accepts an unbounded date range with no row cap, and `AttendanceRecord`'s `lazy='selectin'` relationships hydrate Location/Shift objects the export never reads.

**Fix:** `content = await run_in_threadpool(report_export.export_daily, report, export_format, ctx)`; move the openpyxl/reportlab imports inside the xlsx/pdf renderer functions; cap the exportable range (e.g. 366 days).

## 8. [CONFIRMED] CamerasPage clamps the rendered page but never syncs `page` state — silent jump-back

**File:** `frontend/src/features/cameras/CamerasPage.tsx:199,222`

`safePage = Math.min(page, pageCount)` clamps the view, but nothing writes the clamped value back to state. User on page 3 deletes cameras until pageCount is 2: the grid shows page 2 while `page` stays 3. When pageCount returns to 3 (camera added, or cameras flip online under the `online` filter during a refetch), the grid silently jumps back to page 3 with no user action.

**Fix:** sync state when clamping (`useEffect` that calls `setPage(pageCount)` when `page > pageCount`), or store the page in a way that derives from the clamp.

## 9. [CONFIRMED] Export status colors keyed by display label — typed records lose their color

**File:** `backend/app/services/report_export.py:196-198,398,726`

The comment says "keep status for colors," but the cell value is `_status_label(e.attendance_type or e.status)` and both renderers look up `_STATUS_COLORS` by the **displayed text**. `attendance_type` is a free-form nullable string; any value outside the status vocabulary (the repo's own fixtures use `"manual"`, `seed_loadtest.py` writes `"regular"`) misses the color map and renders uncolored, while the on-screen badge still tones by `r.status`. Exported file diverges from the screen it claims to mirror.

**Fix:** carry `e.status` alongside the row (as the comment intends) and key the color lookup on it, independent of the displayed label.

## 10. [PLAUSIBLE] SnapshotImage blob cache: FIFO eviction can revoke a URL still on screen, with no retry path

**File:** `frontend/src/shared/components/SnapshotImage.tsx:27-45,89`

Cache hits never refresh recency (plain `Map.get`, no delete+set), and eviction at 300 entries revokes the oldest URL. A long session (page navigations + focus refetches with the lightbox open) can revoke the URL of a still-mounted image; the `<img>` has no `onError` and the effect only re-runs on `eventId`/`inView` change, so the image stays broken until remount. The file's own comment rests on "the oldest of 300 is no longer on screen," which the no-LRU design doesn't guarantee.

**Fix:** LRU-touch on cache hit (`delete` + `set`), and/or wire `onError` to clear `src` and refetch.

---

## Cleanup notes (verified, below the severity cut)

- **Duplicated cache surgery (4 copies + 1 variant):** the row-removal updater `{...old, data: old.data.filter(...), total: old.total - 1}` is copy-pasted in `cameras/api/queries.ts:70`, `building/api/queries.ts:63`, `employees/api/queries.ts:72`, `visitors/api/queries.ts:144` (and a variant in `shifts/api/queries.ts:80`). The identical `useInvalidateXKey` micro-hook is duplicated in building/rfid/shifts. Extract a shared `removeFromPaginated(id)` helper and a single `useInvalidateKey(key)` in `shared/` — this is also where the finding-5 fix would then live once.
- **SnapshotImage forks AuthImage:** `shared/components/AuthImage.tsx` already implements the authenticated blob-image pattern (blob fetch, failed state, pulse placeholder, tracked-prop reset). SnapshotImage duplicates all of it and adds caching + laziness only for itself. Fold the cache/lazy behavior into AuthImage as opt-in props so the two don't drift.
- **Download filename derived in three places:** the backend already sends `Content-Disposition: attachment; filename=...` (`reports.py:138`), yet `ExportButtons` takes a `basename` prop that ReportsPage and AttendancePage each recompute. Parse the filename from the response header in `fetchReportExport` instead.
- **PrivacyPage inlines the blob-download sequence** this diff just extracted into `shared/lib/download.ts` — replace the inline copy at `PrivacyPage.tsx:115-120` with `downloadBlob(...)`.
- **report_export.py duplicates table specs per format:** headers/widths/totals are rebuilt separately for xlsx vs PDF for all three report types (e.g. `_monthly_xlsx` 462-493 vs `_monthly_pdf` 771-801); a single per-report table spec consumed by both renderers prevents column drift between formats.
