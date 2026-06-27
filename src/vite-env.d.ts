/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL de la API versionada (incluye `/api/v1`). */
  readonly VITE_API_BASE_URL: string
  /** URL del health check de liveness (raíz, sin auth). Opcional. */
  readonly VITE_HEALTH_URL?: string
  /**
   * Tamaño máximo de página (`size`) que el frontend solicita a la API. Debe
   * coincidir con el límite del backend (§3). Opcional: fallback `50`.
   */
  readonly VITE_MAX_PAGE_SIZE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
