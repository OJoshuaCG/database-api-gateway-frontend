import { z } from 'zod'
import { capabilityGrantUserRefSchema } from './capability-grants'
import {
  gatewayUserCreatedOutSchema,
  gatewayUserOutSchema,
  scopeGrantOutSchema,
} from './gateway-users'

/**
 * Elevaciones de acceso con segundo aprobador (`/access-requests`, api-reference-v29 §9, C3).
 *
 * El techo por TENENCIA («no otorgás más de lo que tenés», `access.grant_ceiling_exceeded`) se
 * retiró: obligaba a que quien administra accesos tuviera cada deber que reparte. Lo reemplazan la
 * política de ASIGNACIÓN (`access_admin` asigna cualquier rol, global o capacidad otorgable) y el
 * SEGUNDO APROBADOR: lo exclusivo de `owner` en cualquier forma (rol base o por alcance `owner`,
 * cualquier global agregada, un `sod_override`) nace como solicitud pendiente hasta que OTRO
 * `access_admin` la apruebe.
 *
 * Mismas reglas de vocabulario que el resto del módulo: en las respuestas, `status`, `origin` y
 * `kind` van `z.string()` (un valor nuevo del backend no tumba el envelope entero).
 */

// ── Vocabularios ───────────────────────────────────────────────────────────────
/** Estados de una solicitud. Solo `pending` espera decisión; el resto es terminal. */
export const ACCESS_REQUEST_STATUSES = [
  'pending',
  'applied',
  'rejected',
  'cancelled',
  'expired',
] as const
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number]

/** De qué escritor nació: el alta, el PATCH o el reemplazo de accesos. */
export const ACCESS_REQUEST_ORIGINS = ['create', 'update', 'set_access'] as const
export type AccessRequestOrigin = (typeof ACCESS_REQUEST_ORIGINS)[number]

/** `elevations[].kind`: la misma forma que las fuentes de `access.sod_conflict`. */
export const ACCESS_ELEVATION_KINDS = ['base_role', 'scope_grant', 'global_capability'] as const
export type AccessElevationKind = (typeof ACCESS_ELEVATION_KINDS)[number]

/** `data.code` del `202`: NO es un error, es «una parte quedó pendiente». */
export const ACCESS_ELEVATION_PENDING_CODE = 'access.elevation_pending'

// ── Respuestas ─────────────────────────────────────────────────────────────────
/**
 * Una elevación de la solicitud. El backend la publica como `dict` libre (`{kind, role,
 * scope_type, scope_id, global_capability}`), así que cada campo es opcional y la UI mira `kind`.
 */
export const accessElevationSchema = z.object({
  kind: z.string(),
  role: z.string().nullish(),
  scope_type: z.string().nullish(),
  scope_id: z.number().int().nullish(),
  global_capability: z.string().nullish(),
  capability: z.string().nullish(),
})
export type AccessElevation = z.infer<typeof accessElevationSchema>

/** El acceso FINAL que deja la solicitud si se aprueba (no un delta). */
export const accessRequestDesiredSchema = z.object({
  gateway_role: z.string(),
  global_capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  scope_grants: z
    .array(scopeGrantOutSchema)
    .nullish()
    .transform((value) => value ?? []),
})
export type AccessRequestDesired = z.infer<typeof accessRequestDesiredSchema>

/** El break-glass que viaja con la solicitud y se aplica junto con la elevación. */
export const accessRequestSodOverrideSchema = z.object({
  reason: z.string(),
  expires_in_hours: z.number().int().nullish(),
})
export type AccessRequestSodOverride = z.infer<typeof accessRequestSodOverrideSchema>

/** `AccessRequestOut` (§9.3/§9.4). */
export const accessRequestSchema = z.object({
  id: z.number().int(),
  target: capabilityGrantUserRefSchema,
  requested_by: capabilityGrantUserRefSchema.nullish(),
  status: z.string(),
  origin: z.string().nullish(),
  desired: accessRequestDesiredSchema,
  elevations: z
    .array(accessElevationSchema)
    .nullish()
    .transform((value) => value ?? []),
  sod_override: accessRequestSodOverrideSchema.nullish(),
  created_at: z.string().nullish(),
  /** Solo las pendientes vencen (7 días). */
  expires_at: z.string().nullish(),
  decided_by: capabilityGrantUserRefSchema.nullish(),
  decided_at: z.string().nullish(),
  /**
   * Motivo de la decisión, o el cierre automático: `expired` | `requester_lost_access` |
   * `superseded` | `stale`.
   */
  reason: z.string().nullish(),
})
export type AccessRequest = z.infer<typeof accessRequestSchema>

/**
 * Fila de la bandeja. `can_decide` y `blocked_reason` los calcula el servidor para quien pregunta:
 * la UI deshabilita con ellos y nunca los recalcula.
 */
export const pendingAccessRequestSchema = accessRequestSchema.extend({
  can_decide: z.boolean(),
  blocked_reason: z.string().nullish(),
})
export type PendingAccessRequest = z.infer<typeof pendingAccessRequestSchema>

/**
 * Campos que suma el `202 access.elevation_pending` a la persona. Van opcionales en un solo schema
 * —y no como dos respuestas distintas— porque el `200`/`201` de siempre es la misma forma SIN
 * ellos (§9.3): «la persona tal como quedó» es el `data` en los dos casos.
 */
const elevationPendingFields = {
  code: z.string().nullish(),
  pending_request: accessRequestSchema.nullish(),
}

/** `PATCH /gateway-users/{id}` y `PUT …/access`: `GatewayUserOut` o `GatewayUserPendingOut`. */
export const gatewayUserWriteOutSchema = gatewayUserOutSchema.extend(elevationPendingFields)
export type GatewayUserWriteOut = z.infer<typeof gatewayUserWriteOutSchema>

/** `POST /gateway-users`: `GatewayUserCreatedOut` o `GatewayUserCreatedPendingOut`. */
export const gatewayUserCreatedWriteOutSchema =
  gatewayUserCreatedOutSchema.extend(elevationPendingFields)
export type GatewayUserCreatedWriteOut = z.infer<typeof gatewayUserCreatedWriteOutSchema>

/**
 * La solicitud pendiente de una respuesta de escritura, o `null` si todo se aplicó. Se mira el
 * `code` además del campo: es lo que el contrato fija como señal (§9.7).
 */
export function pendingElevationOf(result: {
  code?: string | null
  pending_request?: AccessRequest | null
}): AccessRequest | null {
  return result.code === ACCESS_ELEVATION_PENDING_CODE && result.pending_request
    ? result.pending_request
    : null
}

// ── Peticiones ─────────────────────────────────────────────────────────────────
/** Cuerpo de aprobar, rechazar o cancelar: el motivo es opcional (máx. 500). */
export const accessRequestDecisionSchema = z.object({
  reason: z.string().max(500, 'Máximo 500 caracteres').optional(),
})
export type AccessRequestDecision = z.infer<typeof accessRequestDecisionSchema>

// ── Códigos de error ───────────────────────────────────────────────────────────
/**
 * `detail.public_context.code` de `/access-requests` (§9.4). Los que comparte con las capacidades
 * puntuales (`self_approval_forbidden`, `grant_user_inactive`, `sod_conflict`…) se repiten acá con
 * el mismo string, para tener el vocabulario del flujo en un solo lugar.
 */
export const ACCESS_REQUEST_ERROR_CODES = {
  requestNotFound: 'access.request_not_found',
  requestNotPending: 'access.request_not_pending',
  requestStale: 'access.request_stale',
  requestNotRequester: 'access.request_not_requester',
  selfApprovalForbidden: 'access.self_approval_forbidden',
  selfModificationForbidden: 'access.self_modification_forbidden',
  grantUserInactive: 'access.grant_user_inactive',
  notAssignable: 'access.not_assignable',
  sodConflict: 'access.sod_conflict',
  lastAdminProtected: 'access.last_admin_protected',
} as const
