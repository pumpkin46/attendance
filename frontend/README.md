# Attendance Platform — Frontend

React 19 + TypeScript + Vite admin UI.

## Scripts

```bash
npm run dev        # start dev server (proxies /api -> :8000)
npm run build      # type-check (tsc -b) + production build
npm run lint       # eslint
npm run test       # vitest (watch)
npm run test:run   # vitest (once)
```

## Architecture

The codebase is organized **by feature** rather than by file type. Each feature
owns its pages, data-access, and types; cross-cutting building blocks live under
`shared/`.

```
src/
  app/                 # entry point + root component (providers + router)
    main.tsx           #   ReactDOM root: <Provider> + <QueryClientProvider>
    App.tsx            #   routes, ErrorBoundary, Auth/Realtime providers
  store/               # Redux store wiring
    index.ts           #   configureStore + makeStore() + RootState/AppDispatch
    hooks.ts           #   typed useAppDispatch / useAppSelector
  features/            # one folder per domain
    auth/              #   AuthProvider + useAuth, authSlice, LoginPage, ProtectedRoute
    tenant/            #   tenantSlice (super-admin org context)
    realtime/          #   WebSocket -> react-query cache invalidation
    visitors/          #   VisitorsPage + components/ (tabs) + api/queries + types
    cameras/  shifts/  enrollment/  access/  building/  security/   # api/ + types + page(s)
    dashboard/ monitoring/ employees/ kiosk/ recognition/ attendance/
    anomalies/ rfid/ reports/ audit/
  shared/              # reusable, feature-agnostic code
    ui/                #   design-system primitives (Button, Card, DataTable, ...)
    components/        #   shared widgets (AppLogo, ErrorBoundary, FaceCaptureModal, ...)
    hooks/             #   useApiQuery, useWebcam
    lib/               #   cn, session, queryClient, authMedia, inputClass
    api/               #   axios client + error helpers
    types/             #   shared domain types
  layouts/             # authenticated app shell (AppLayout)
  test/                # vitest setup
```

### Conventions

- **Imports use the `@/` alias** (`@/* -> src/*`), configured in
  `tsconfig.app.json` (`paths`) and `vite.config.ts` (`resolve.alias`). Prefer
  `@/shared/ui/Button` over deep relative paths.
- **State**: Redux Toolkit owns global client state (auth user, tenant context);
  **TanStack Query** owns server state (per-feature `api/queries.ts`). The token
  itself is persisted in `shared/lib/session.ts` (localStorage) and attached by
  the axios interceptor.
- A feature's `api/queries.ts` holds its react-query hooks; `types.ts` holds its
  request/response types; `components/` holds feature-local components.
- Anything imported by two or more features belongs in `shared/`.
