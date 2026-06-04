/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the backend API. Defaults to `/api/v1` (proxied in dev). */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
