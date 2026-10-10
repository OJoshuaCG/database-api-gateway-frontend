import { z } from 'zod'

/**
 * Lectura de la auditoría (api-reference-v29 §11.3–11.4). Solo `audit.read`, que tiene solo
 * `security_officer`: quien hace los cambios de acceso (`access_admin`) no lee el rastro que los
 * registra. Los `GET` no piden step-up.
 */

/** Clases de actor que acepta el filtro `actor_type`. Otro valor → 422. */
export const AUDIT_ACTOR_TYPES = [
  'admin',
  'api_token',
  'integration',
  'system',
  'anonymous',
] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

/**
 * Una fila de `audit_log`, tal cual se guardó.
 *
 * `actor_type` y `status` son **vocabularios abiertos** (el backend los declara `str`): un `z.enum`
 * tumbaría la página entera con el primer valor nuevo, así que van como `string` y la UI cae a un
 * texto genérico para lo que no conoce. `detail_json` depende de la acción (objeto, lista o `null`
 * si `detail` es texto libre): se declara `unknown` y se muestra tal cual, sin interpretarlo.
 */
export const auditLogEntrySchema = z.object({
  id: z.number().int(),
  /** UTC **sin zona**: se muestra con `formatUtcDateTime`. */
  created_at: z.string(),
  request_id: z.string().nullish(),
  actor_type: z.string(),
  admin_id: z.number().int().nullish(),
  /** Username desnormalizado, o `token:<token_id>` si actuó un token. */
  admin_username: z.string().nullish(),
  /** PK del token de agente (nunca el bearer). */
  api_token_id: z.number().int().nullish(),
  action: z.string(),
  target_type: z.string().nullish(),
  target_id: z.number().int().nullish(),
  server_id: z.number().int().nullish(),
  touched_engine: z.boolean(),
  status: z.string(),
  detail: z.string().nullish(),
  detail_json: z.unknown().nullable().optional(),
  /**
   * `true` = `detail` es de una acción `query_console.*` y el servidor reemplazó los literales del
   * SQL por `?` porque quien lee no puede ejecutar SQL en el destino. Ausente o nulo (backend
   * anterior) equivale a `false`: se declara opcional y no con un default para no obligar a quien
   * arma una entrada a mano a repetirlo.
   */
  detail_masked: z.boolean().nullish(),
  ip: z.string().nullish(),
  grantee: z.string().nullish(),
  privilege: z.string().nullish(),
  object_level: z.string().nullish(),
  object_name: z.string().nullish(),
  with_grant_option: z.boolean().nullish(),
  grantor: z.string().nullish(),
})
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>

/** Filtros de `GET /audit-log` (todos opcionales, se combinan con AND). */
export interface AuditLogFilters {
  /** Exacto, o prefijo si termina en `*` (`access.*`). Máx. 65. */
  action?: string
  admin_id?: number
  admin_username?: string
  actor_type?: AuditActorType
  api_token_id?: number
  target_type?: string
  target_id?: number
  server_id?: number
  status?: string
  request_id?: string
  /** ISO 8601, inclusive. Sin zona = UTC: la UI siempre manda con `Z`. */
  from?: string
  /** ISO 8601, **exclusive**. */
  to?: string
}

export const AUDIT_ERROR_CODES = {
  /** 422: `from >= to`. */
  invalidRange: 'audit.invalid_range',
  /** 404 de `GET /audit-log/{id}`. */
  notFound: 'audit.not_found',
} as const
