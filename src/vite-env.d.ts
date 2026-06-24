/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL de la API versionada (incluye `/api/v1`). */
  readonly VITE_API_BASE_URL: string
  /** URL del health check de liveness (raíz, sin auth). Opcional. */
  readonly VITE_HEALTH_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
