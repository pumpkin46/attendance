# AI Attendance Platform — Project Review

> **Note:** The Laravel PHP backend was removed; the API and attendance logic now live in `backend/` (FastAPI). Sections below that mention PHP/Laravel are historical.

**Review date:** 2026-06-01  
**Scope:** Monorepo (`frontend`, `backend`, `scripts`)

---

## Executive summary

This is a **feature-rich, enterprise-oriented attendance platform** with face recognition, RFID, edge inference, visitor kiosks, smart-building hooks, and security monitoring. Architecture: **FastAPI (`backend/`)** provides the REST API, attendance engine, and face recognition; **React** provides the admin UI.

The codebase is substantial (~110 PHP application files, ~35 Eloquent models, 18 migrations, 24+ UI pages, ~3,600 lines in backend services alone) and well documented in the root `README.md`. The main gaps for production readiness are **automated tests**, **CI/CD**, and **hardening the AI service network boundary**.

| Area | Rating | Notes |
|------|--------|--------|
| Architecture & separation of concerns | Strong | Attendance logic centralized in Laravel |
| Feature completeness | Strong | RBAC, edge, RFID, visitors, anomalies, audit |
| Security design | Good (with caveats) | Argon2id, tenancy, permissions; AI service unauthenticated |
| Documentation | Strong | README, NFR table, per-service READMEs |
| Test coverage | Weak | No `tests/` tree, no `phpunit.xml`, no frontend tests |
| DevOps / CI | Missing | No `.github/workflows` or equivalent |
| Dependency hygiene | Good | Pinned Python deps; `composer.lock` / `package-lock.json` present |

---

## Architecture

```
┌─────────────────┐     Sanctum JWT      ┌──────────────────┐
│  React (Vite)   │ ──────────────────► │  Laravel API     │
│  :5173          │                     │  :8000           │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
             PostgreSQL                      Redis (prod)              FastAPI AI :8001
             (source of truth)              queues/cache               FAISS + InsightFace
                    ▲
                    │  match results only (no images)
             ┌──────┴──────┐
             │ edge camera │ ──► optional local backend on camera site
             └─────────────┘
```

**Design strengths**

- **Single writer for attendance:** `AttendanceService` handles check-in/out, duplicate windows (60s cache), shift/policy gates, and audit side effects. AI never writes attendance records.
- **Service layer:** ~20 dedicated services (`AiRecognitionClient`, `FaceEnrollmentService`, `SecurityMonitoringService`, etc.) keep controllers thinner.
- **Device auth patterns:** Separate middleware for RFID readers, edge devices, and visitor kiosks (`AuthenticateRfidReader`, `AuthenticateEdgeDevice`, `AuthenticateVisitorKiosk`).
- **Multi-tenancy:** `EnforceTenantIsolation` + `TenantContext` + `X-Organization-Id` header on the frontend API client.
- **NFR traceability:** Config-driven SLA, capacity limits, health endpoint, and documented scaling (`AI_SERVICE_URLS` round-robin).

---

## Component review

### Backend (Laravel 11)

| Aspect | Assessment |
|--------|------------|
| API surface | ~220 lines in `routes/api.php`; RESTful resources + specialized flows (recognition, kiosk, edge, building) |
| Auth | Sanctum tokens; LDAP/SAML/OAuth hooks in routes |
| Passwords | `MigratingArgon2IdHasher` upgrades legacy bcrypt on login |
| RBAC | `CheckPermission` middleware on sensitive routes |
| Background work | Artisan commands: `PollCameraStreams`, `DetectAttendanceAnomalies`, `PurgePrivacyData`, `ExpireVisitors` |
| Models | 35 models covering employees, cameras, RFID, visitors, security alerts, building connectors |

**Notable implementation:** `RecognitionController` orchestrates AI identify → threshold check → liveness → `AttendanceService` → access control / security alerts — appropriate orchestration layer.

**Gaps**

- `phpunit/phpunit` is in `composer.json` but there is **no `tests/` directory** and **no `phpunit.xml`** — testing is not wired up.
- `QUEUE_CONNECTION=sync` and `CACHE_STORE=file` by default (fine for local dev; must switch for production — documented).

### Frontend (React 19 + TypeScript + Vite)

| Aspect | Assessment |
|--------|------------|
| Structure | Pages per domain, `ProtectedRoute`, `AuthContext`, shared `api/client.ts` |
| UX coverage | Dashboard, monitoring, enrollment, recognition/liveness test pages, kiosk routes |
| Tooling | ESLint 10, Tailwind 4, strict-ish TypeScript build (`tsc -b`) |

**Gaps**

- No unit/E2E test scripts in `package.json`.
- Token stored in `localStorage` (common SPA pattern; consider httpOnly cookies or short-lived tokens for high-security deployments).

### AI service (FastAPI)

| Aspect | Assessment |
|--------|------------|
| Pipeline | Documented stages: decode → detect → track → quality → liveness → embed → FAISS search |
| Resilience | Mock embedding mode when InsightFace models are absent (dev-friendly) |
| Features | Enroll (single/batch/structured), identify, recognize, stream capture, anomaly ML, embedding import/export for edge |
| Dependencies | Pinned versions in `requirements.txt` (FastAPI 0.136, FAISS 1.14, ONNX Runtime 1.23) |

**Security concern (high priority for production)**

- **No API authentication** on `/api/v1/*` endpoints.
- **CORS allows `*`** with `allow_credentials=True` in `main.py`.
- Service should be **network-isolated** (localhost/VPC only, reachable by Laravel and edge sync). Do not expose port 8001 to the public internet.

### Edge cameras (no separate agent package)

- **Edge deployment mode** on cameras: run a local `backend` on hardware; sync embeddings via export/import APIs.
- The standalone `edge-agent` package was removed from the repo.

---

## Security review

### Implemented well

| Control | Implementation |
|---------|----------------|
| Password hashing | Argon2id (`HASH_DRIVER`), bcrypt migration on login |
| API auth | Sanctum bearer tokens for admin API |
| RBAC | Named permissions on routes (`employees.manage`, `security.monitor`, etc.) |
| Tenant isolation | Middleware + organization scoping |
| HTTPS enforcement | `ForceHttps` middleware + `FORCE_HTTPS` env |
| Audit trail | `AuditService` on sensitive operations |
| GDPR | Retention config + `privacy:purge-retention` command + privacy API |
| Device tokens | One-time tokens for RFID readers, edge devices, visitor kiosks |
| Recognition threshold | Default 0.95, configurable |
| Duplicate suppression | 60s cache window for face and RFID |

### Risks and recommendations

1. **AI service trust boundary** — Treat as an internal microservice. Add firewall rules or bind to `127.0.0.1`; optionally add a shared secret header validated by both Laravel and FastAPI.
2. **Default credentials** — Seeder/README use `admin@attendance.local` / `password`. Mandatory change on first deploy.
3. **CORS on AI service** — Restrict origins or remove CORS if only server-to-server calls are used.
4. **Recognition test endpoints** — Authenticated admin routes can trigger identify/recognize; ensure production roles limit who has `recognition.view` / related permissions.
5. **Snapshot storage** — Unknown faces and recognition snapshots under `storage/`; ensure disk encryption and retention policies match GDPR settings.
6. **`.env` files** — Correctly gitignored; verify no secrets are committed (`.env` should never be in git).

---

## Code quality

| Signal | Finding |
|--------|---------|
| TODO / FIXME | None found in `backend/app`, `frontend/src` (quick scan) |
| Layering | Consistent service injection in controllers |
| Config | Extensive `.env.example` with NFR, GDPR, RFID, edge, visitor, building sections |
| Lock files | `composer.lock` and `package-lock.json` present |
| Gitignore | Thorough monorepo ignore (venv, FAISS data, enrollment blobs, models) |

**Maintainability:** Large `api.php` and many pages are manageable at current size; consider route splitting or OpenAPI spec if the API grows further.

---

## Testing and quality assurance

| Layer | Status |
|-------|--------|
| Backend PHPUnit | **Not set up** (dependency declared, no tests) |
| Frontend | **No test runner** configured |
| AI service | **No pytest** config observed |
| Manual | `scripts/test-face.py` exists for ad-hoc face testing |
| Lint | Frontend: `npm run lint`; Backend: Laravel Pint in dev deps (no npm script alias in root) |

**Recommended minimum test suite**

1. **Backend:** Auth login, permission denial, `AttendanceService` duplicate window, RFID tap happy path, tenant isolation.
2. **AI service:** Mock embedding identify/enroll round-trip, threshold behavior, invalid image handling.
3. **Frontend:** Smoke test for login + protected route (Playwright or Vitest + MSW).

---

## Operations and deployment

| Topic | Status |
|-------|--------|
| Docker | Explicitly **not** used; local/native install documented |
| CI/CD | **None** — add pipeline for lint, `php artisan test`, `npm run build`, AI smoke tests |
| Health checks | `GET /api/v1/health` (Laravel), `GET /health` (AI) |
| Scaling | Documented: multiple AI nodes, Redis queues, shared FAISS storage |
| Observability | Logs via Laravel `LOG_CHANNEL`; no structured APM/metrics integration noted |
| Secrets | Env-based; rotation guidance in README for `APP_KEY` |

**Production checklist (from docs + review)**

- [ ] `APP_ENV=production`, `APP_DEBUG=false`, `FORCE_HTTPS=true`
- [ ] `QUEUE_CONNECTION=redis`, `CACHE_STORE=redis`
- [ ] PostgreSQL SSL (`DB_SSLMODE=require`)
- [ ] AI service on private network only
- [ ] Change default admin password
- [ ] TLS 1.3 at reverse proxy
- [ ] Schedule `privacy:purge-retention` and `attendance:detect-anomalies`

---

## Feature matrix (implemented vs documented)

| Module | README | Code presence |
|--------|--------|---------------|
| Auth & RBAC | Yes | Routes, permissions, roles seeder |
| Face enrollment / recognition | Yes | `FaceEnrollmentController`, AI enroll APIs |
| RFID | Yes | Readers, cards, tap controller, events |
| Attendance engine | Yes | `AttendanceService`, policies, shifts |
| Anomaly detection | Yes | `AttendanceAnomalyService`, AI `anomaly_detector` |
| Cameras & monitoring | Yes | `CameraController`, poll command |
| Edge cameras | Partial | Edge deployment mode + embedding sync APIs (no edge-agent package) |
| Visitor kiosks | Yes | Kiosk API + public `/visitor-kiosk` route |
| Smart building | Yes | `BuildingIntegrationController` |
| Security monitoring | Yes | Alerts, acknowledge/resolve |
| Audit & privacy | Yes | Audit logs, GDPR endpoints |
| LDAP / SAML / OAuth | Yes | Auth routes (configure via `.env`) |

Feature documentation and code structure are **aligned** — uncommon for projects of this size.

---

## Prioritized recommendations

### P0 — Before production

1. **Network-isolate the AI service** and optionally add service-to-service authentication.
2. **Rotate default admin password** and disable debug mode.
3. **Enable Redis** for cache and queues in production.

### P1 — Reliability and compliance

4. **Add automated tests** (backend feature tests first — attendance + auth + RFID).
5. **Add CI** (GitHub Actions: `composer install`, `php artisan test`, `npm ci && npm run build`, optional AI health smoke).
6. **Create `phpunit.xml`** and a `tests/Feature` baseline even if small.

### P2 — Hardening and ops

7. Restrict AI service CORS; bind to internal interface only.
8. Add **OpenAPI/Swagger** or Postman collection for the 200+ line API surface.
9. Add **rate limiting** on `/auth/login`, `/recognition/identify`, and kiosk/RFID public endpoints.
10. Consider **refresh tokens** or shorter Sanctum token TTL for admin UI.

### P3 — Nice to have

11. Structured logging (JSON) and recognition SLA dashboards from `RecognitionMetricsService`.
12. Frontend E2E tests for enrollment and kiosk flows.
13. Docker Compose optional profile for local full-stack (without making Docker mandatory).

---

## Summary

The project is **well-architected and feature-complete** for an enterprise attendance product, with unusually good README/NFR documentation and sensible boundaries between Laravel, AI, and edge components. It reads as a **mature prototype or MVP ready for hardening**, not yet a production system without tests, CI, and AI service network controls.

The highest-impact next steps are: **secure the AI service**, **introduce backend feature tests + CI**, and **run through the production checklist** in the README security section.

---

*This review is based on static analysis of the repository structure, configuration, routes, and representative services. Runtime behavior (recognition accuracy, SLA under load) was not benchmarked.*
