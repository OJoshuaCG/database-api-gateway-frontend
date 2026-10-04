import { API_TOKEN_DATA_MAX_TTL_DAYS, API_TOKEN_DATA_SCOPES, hasDataScope } from '@/lib/contracts'

/**
 * Reglas de UI de los scopes de DATOS de un token (`data.read`, `data.query`). Lógica pura: la
 * autoridad es el servidor (422 `ttl_too_long`, 403 de step-up), esto solo evita que el operador
 * descubra la regla por el error.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** ¿Trae zona horaria (`Z` u offset `±hh:mm`)? */
const HAS_TIMEZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/** Los scopes de datos de una lista, en el orden en que vienen. */
export function dataScopesOf(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => (API_TOKEN_DATA_SCOPES as readonly string[]).includes(scope))
}

/**
 * Días que le quedan a un token. `expires_at` viaja en UTC SIN zona: `Date.parse` lo leería en hora
 * local y el cálculo se movería horas. `null` si no hay fecha legible (el servidor decide igual).
 * `nowMs` entra por parámetro: leer el reloj en render es impuro.
 */
export function remainingDays(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null
  const ms = Date.parse(HAS_TIMEZONE.test(expiresAt) ? expiresAt : `${expiresAt}Z`)
  if (Number.isNaN(ms)) return null
  return (ms - nowMs) / DAY_MS
}

/**
 * ¿Agregar un scope de datos a un token con esta vida restante pasaría el tope? Solo cuenta si la
 * selección pide datos: un token largo sigue pudiéndose editar sin ellos.
 */
export function dataScopeTtlBlocked(
  scopes: readonly string[],
  expiresAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!hasDataScope(scopes)) return false
  const remaining = remainingDays(expiresAt, nowMs)
  return remaining !== null && remaining > API_TOKEN_DATA_MAX_TTL_DAYS
}
