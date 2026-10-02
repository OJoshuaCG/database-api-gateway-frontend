import type { BadgeTone } from '@/components/ui'
import type { QueryParams } from '@/lib/api/client'
import {
  AUDIT_ACTOR_TYPES,
  PAGINATION,
  type AuditActorType,
  type AuditLogEntry,
  type AuditLogFilters,
} from '@/lib/contracts'

/**
 * Lógica pura de la pantalla de auditoría (v29 §11.3): URL ⇄ filtros ⇄ query del backend, y cómo
 * se nombra cada actor, destino y estado. Sin React, para probarla sin montar nada.
 */

// ── Presets de acción ──────────────────────────────────────────────────────────

/**
 * Prefijos frecuentes. El backend toma `action` como prefijo cuando termina en `*`, y `%`/`_` como
 * literales, así que estos valores viajan tal cual.
 */
export const AUDIT_ACTION_PRESETS: readonly { value: string; label: string }[] = [
  { value: 'access.*', label: 'Accesos' },
  { value: 'gateway_user.*', label: 'Usuarios del gateway' },
  { value: 'auth.*', label: 'Sesión y login' },
  { value: 'capability_grant.*', label: 'Capacidades puntuales' },
  { value: 'access_request.*', label: 'Elevaciones' },
  { value: 'api_token.*', label: 'Tokens de agente' },
]

/** Topes del backend: un valor más largo es un 422, así que el input no deja escribirlo. */
export const AUDIT_LIMITS = {
  action: 65,
  username: 128,
  status: 20,
  requestId: 32,
} as const

// ── Estado de la URL ───────────────────────────────────────────────────────────

/** Nombres de los parámetros en la URL. Son los del backend para que un enlace se lea igual. */
const TEXT_KEYS = [
  'action',
  'admin_username',
  'target_type',
  'status',
  'request_id',
  'from',
  'to',
] as const
const INT_KEYS = ['admin_id', 'api_token_id', 'target_id', 'server_id'] as const

/** El detalle abierto (`GET /audit-log/{id}`). No es un filtro: no viaja al listado. */
export const AUDIT_ENTRY_PARAM = 'entrada'

export interface AuditSearchState {
  filters: AuditLogFilters
  page: number
  size: number
}

function positiveInt(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed >= 1 ? parsed : undefined
}

function isActorType(value: string | null): value is AuditActorType {
  return value !== null && (AUDIT_ACTOR_TYPES as readonly string[]).includes(value)
}

/**
 * Lee los filtros de la URL. Lo que no se entiende se descarta en silencio en vez de mandarlo y
 * cosechar un 422: un `actor_type` inventado o un `page=abc` en un enlace viejo no rompen la página.
 */
export function parseAuditSearch(params: URLSearchParams): AuditSearchState {
  const filters: AuditLogFilters = {}
  for (const key of TEXT_KEYS) {
    const value = params.get(key)?.trim()
    if (value) filters[key] = value
  }
  for (const key of INT_KEYS) {
    const value = positiveInt(params.get(key))
    if (value !== undefined) filters[key] = value
  }
  const actorType = params.get('actor_type')
  if (isActorType(actorType)) filters.actor_type = actorType
  const size = positiveInt(params.get('size'))
  return {
    filters,
    page: positiveInt(params.get('page')) ?? 1,
    size: size !== undefined && size <= PAGINATION.maxSize ? size : PAGINATION.defaultSize,
  }
}

/**
 * Escribe el estado en la URL, sin los valores por omisión (página 1, tamaño por defecto) para que
 * la URL de «sin filtros» sea la ruta pelada. Conserva los parámetros ajenos (`?entrada=`).
 */
export function writeAuditSearch(
  previous: URLSearchParams,
  state: AuditSearchState,
): URLSearchParams {
  const next = new URLSearchParams(previous)
  for (const key of [...TEXT_KEYS, ...INT_KEYS, 'actor_type', 'page', 'size']) next.delete(key)
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== undefined && value !== '') next.set(key, String(value))
  }
  if (state.page > 1) next.set('page', String(state.page))
  if (state.size !== PAGINATION.defaultSize) next.set('size', String(state.size))
  return next
}

/** ¿Hay algún filtro puesto? Decide el estado vacío («sin entradas» vs «nada coincide»). */
export function hasAuditFilters(filters: AuditLogFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '')
}

/** Query del backend: los filtros con sus nombres de API más `page`/`size`. */
export function auditQueryParams(state: AuditSearchState): QueryParams {
  return { ...state.filters, page: state.page, size: state.size }
}

/** `from >= to` es el 422 `audit.invalid_range`: se avisa antes de pedirlo. */
export function isInvalidRange(filters: AuditLogFilters): boolean {
  if (!filters.from || !filters.to) return false
  const from = Date.parse(filters.from)
  const to = Date.parse(filters.to)
  return !Number.isNaN(from) && !Number.isNaN(to) && from >= to
}

// ── Fechas del filtro ──────────────────────────────────────────────────────────

/**
 * Valor de un `<input type="datetime-local">` (hora LOCAL, sin zona) → instante UTC con `Z`, que es
 * lo que viaja en la URL y al backend. Sin zona el backend asume UTC, así que mandar la hora local
 * tal cual correría el rango la diferencia horaria.
 */
export function localInputToUtc(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Instante UTC de la URL → valor para el `datetime-local` en hora local (`YYYY-MM-DDTHH:mm`). */
export function utcToLocalInput(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

// ── Cómo se nombra cada cosa ───────────────────────────────────────────────────

export const AUDIT_ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  admin: 'Usuario del gateway',
  api_token: 'Token de agente',
  system: 'Sistema',
  anonymous: 'Anónimo',
}

/**
 * Quién actuó. Un token se nombra por su PK («Token #12»), nunca por el bearer: es lo único que la
 * fila trae y lo que se cruza con «Tokens de agente». `system` y `anonymous` no tienen persona
 * detrás y se dicen con palabras. Un `actor_type` nuevo cae al username o al valor crudo.
 */
export function auditActorLabel(entry: AuditLogEntry): string {
  switch (entry.actor_type) {
    case 'api_token':
      return entry.api_token_id != null
        ? `Token #${entry.api_token_id}`
        : (entry.admin_username ?? 'Token de agente')
    case 'system':
      return 'Sistema'
    case 'anonymous':
      return 'Anónimo'
    case 'admin':
      return (
        entry.admin_username ?? (entry.admin_id != null ? `Usuario #${entry.admin_id}` : 'Usuario')
      )
    default:
      return entry.admin_username ?? entry.actor_type
  }
}

const TARGET_TYPE_LABELS: Record<string, string> = {
  user: 'Usuario',
  gateway_user: 'Usuario',
  server: 'Servidor',
  server_user: 'Usuario del motor',
  managed_database: 'Base de datos',
  database_model: 'Blueprint',
  environment: 'Entorno',
  project: 'Proyecto',
  api_token: 'Token',
  capability_grant: 'Capacidad puntual',
  access_request: 'Elevación',
  permission_profile: 'Perfil de permisos',
}

/** Sobre qué actuó: «Usuario #9». `null` si la fila no tiene destino. */
export function auditTargetLabel(entry: AuditLogEntry): string | null {
  if (!entry.target_type) return null
  const label = TARGET_TYPE_LABELS[entry.target_type] ?? entry.target_type
  return entry.target_id != null ? `${label} #${entry.target_id}` : label
}

/**
 * Estados conocidos. Es un vocabulario ABIERTO (`attempt`, `denied`, …, y los que vengan): lo que
 * no está acá se muestra crudo en gris, nunca se descarta.
 */
export const AUDIT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  success: { label: 'Éxito', tone: 'success' },
  failure: { label: 'Fallo', tone: 'error' },
  error: { label: 'Error', tone: 'error' },
  denied: { label: 'Denegado', tone: 'warning' },
  attempt: { label: 'Intento', tone: 'info' },
}

export function auditStatus(status: string): { label: string; tone: BadgeTone } {
  return AUDIT_STATUS[status] ?? { label: status, tone: 'neutral' }
}
