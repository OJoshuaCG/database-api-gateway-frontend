import { z } from 'zod'
import { scopeTypeSchema } from './gateway-users'

/**
 * Capacidades PUNTUALES (`capability_grants`): una capacidad concreta otorgada sobre UN entorno o
 * UN servidor, aparte del rol (api-reference §19). Las no sensibles quedan activas al crearse; las
 * sensibles nacen `pending` y las decide una segunda persona con `access_admin`.
 *
 * Las respuestas siguen la regla del módulo de usuarios: los vocabularios (`status`, `capability`,
 * `source`) van `z.string()`, no `z.enum`, porque un valor nuevo del backend no debe tumbar el
 * envelope entero. Las peticiones sí son estrictas.
 */

// ── Vocabularios ───────────────────────────────────────────────────────────────
/**
 * Estados conocidos de una capacidad puntual. «Viva» = `pending` | `active`; el resto son
 * terminales y solo aparecen en el historial.
 */
export const CAPABILITY_GRANT_STATUSES = [
  'pending',
  'active',
  'rejected',
  'expired',
  'cancelled',
  'revoked',
] as const
export const capabilityGrantStatusSchema = z.enum(CAPABILITY_GRANT_STATUSES)
export type CapabilityGrantStatus = z.infer<typeof capabilityGrantStatusSchema>

/** De dónde sale una capacidad efectiva (`effective-access`). */
export const EFFECTIVE_CAPABILITY_SOURCES = [
  'role',
  'scoped_role',
  'global',
  'capability_grant',
] as const

// ── Respuestas ─────────────────────────────────────────────────────────────────
/** Referencia mínima a una persona (quien pidió o decidió). */
export const capabilityGrantUserRefSchema = z.object({
  id: z.number().int(),
  username: z.string(),
})
export type CapabilityGrantUserRef = z.infer<typeof capabilityGrantUserRefSchema>

/**
 * `CapabilityGrantOut`. Todo lo que el backend marca opcional va nullish con default, para no
 * romper si una versión intermedia omite un campo.
 */
export const capabilityGrantSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  username: z.string().nullish(),
  capability: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  /** Nombre del entorno o servidor; `null` si el destino ya no existe. */
  scope_name: z.string().nullish(),
  status: z.string(),
  /** Exige un segundo aprobador. */
  sensitive: z.boolean(),
  requested_by: capabilityGrantUserRefSchema.nullish(),
  requested_at: z.string().nullish(),
  decided_by: capabilityGrantUserRefSchema.nullish(),
  decided_at: z.string().nullish(),
  /** Solo las pendientes vencen; al aprobarse el backend lo deja en `null`. */
  expires_at: z.string().nullish(),
  request_reason: z.string().nullish(),
  decision_reason: z.string().nullish(),
  /** Lecturas que la capacidad trae implícitas. */
  implies: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
})
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>

/**
 * Fila de la bandeja de pendientes. `can_decide` y `blocked_reason` los calcula el servidor: la UI
 * deshabilita con ellos y muestra el motivo, nunca los recalcula (decide el backend al aprobar).
 */
export const pendingCapabilityGrantSchema = capabilityGrantSchema.extend({
  can_decide: z.boolean(),
  /** Código `access.*` que explica por qué no se puede decidir (solo con `can_decide: false`). */
  blocked_reason: z.string().nullish(),
})
export type PendingCapabilityGrant = z.infer<typeof pendingCapabilityGrantSchema>

/**
 * Una capacidad puntual PROPIA dentro de `/auth/me`: solo las vivas (`pending` | `active`).
 * Las pendientes no conceden nada todavía.
 */
export const myCapabilityGrantSchema = z.object({
  id: z.number().int(),
  capability: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  scope_name: z.string().nullish(),
  status: z.string(),
  expires_at: z.string().nullish(),
})
export type MyCapabilityGrant = z.infer<typeof myCapabilityGrantSchema>

// ── `GET /gateway-users/{id}/effective-access` ─────────────────────────────────
export const effectiveScopeRoleSchema = z.object({
  scope_type: z.string(),
  scope_id: z.number().int(),
  scope_name: z.string().nullish(),
  role: z.string(),
})
export type EffectiveScopeRole = z.infer<typeof effectiveScopeRoleSchema>

/**
 * Una capacidad efectiva con su procedencia. Una capacidad con varias fuentes repite filas (una
 * por fuente y alcance). `inert` = retenida pero sin efecto (persona desactivada): no cuenta como
 * acceso.
 */
export const effectiveCapabilitySchema = z.object({
  capability: z.string(),
  source: z.string(),
  scope_type: z.string().nullish(),
  scope_id: z.number().int().nullish(),
  scope_name: z.string().nullish(),
  grant_id: z.number().int().nullish(),
  /** Capacidad puntual que la trae implícita (lectura implícita). */
  implied_by: z.string().nullish(),
  inert: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
})
export type EffectiveCapability = z.infer<typeof effectiveCapabilitySchema>

export const effectiveAccessSchema = z.object({
  user_id: z.number().int(),
  username: z.string(),
  active: z.boolean(),
  base_role: z.string().nullish(),
  scope_roles: z
    .array(effectiveScopeRoleSchema)
    .nullish()
    .transform((value) => value ?? []),
  global_capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  capabilities: z
    .array(effectiveCapabilitySchema)
    .nullish()
    .transform((value) => value ?? []),
  catalog_version: z.string(),
})
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>

// ── Peticiones ─────────────────────────────────────────────────────────────────
/**
 * `POST /gateway-users/{id}/capability-grants`. `scope_type` solo admite `environment` | `server`:
 * `global` no se puede otorgar de forma puntual y el backend lo rechaza con un 422 genérico.
 * `capability` va libre a propósito: una desconocida responde `access.capability_not_grantable`,
 * que sí tiene mensaje propio.
 */
export const capabilityGrantCreateSchema = z.object({
  capability: z.string().min(1),
  scope_type: scopeTypeSchema,
  scope_id: z.number().int().min(1),
  reason: z.string().max(500, 'Máximo 500 caracteres').optional(),
})
export type CapabilityGrantCreate = z.infer<typeof capabilityGrantCreateSchema>

/** Cuerpo de aprobar o rechazar: el motivo es opcional. */
export const capabilityGrantDecisionSchema = z.object({
  reason: z.string().max(500, 'Máximo 500 caracteres').optional(),
})
export type CapabilityGrantDecision = z.infer<typeof capabilityGrantDecisionSchema>

// ── Códigos de error ───────────────────────────────────────────────────────────
/**
 * `detail.public_context.code` de las operaciones sobre capacidades puntuales. Todos son
 * `access.*`, así que `ApiError.gatewayUserContext` también se arma para ellos.
 *
 * `selfModificationForbidden` y `grantCeilingExceeded` ya viven en `GATEWAY_USER_ERROR_CODES`
 * (los comparte `PUT /access`); se repiten acá para que quien trabaja con capacidades puntuales
 * tenga el vocabulario completo en un solo lugar. Los valores son los mismos strings.
 */
export const CAPABILITY_GRANT_ERROR_CODES = {
  selfModificationForbidden: 'access.self_modification_forbidden',
  selfApprovalForbidden: 'access.self_approval_forbidden',
  grantUserInactive: 'access.grant_user_inactive',
  capabilityNotGrantable: 'access.capability_not_grantable',
  grantScopeNotFound: 'access.grant_scope_not_found',
  grantCeilingExceeded: 'access.grant_ceiling_exceeded',
  grantDuplicate: 'access.grant_duplicate',
  grantNotFound: 'access.grant_not_found',
  grantNotPending: 'access.grant_not_pending',
} as const

/**
 * 409 de `DELETE /environments/{id}` y `DELETE /servers/{id}`: todavía hay accesos que apuntan a
 * ese destino. `public_context` trae `access_grant_count` (roles por alcance) y
 * `capability_grant_count` (puntuales `pending`/`active`). Va aparte de
 * `CAPABILITY_GRANT_ERROR_CODES` porque no lo emite ninguna operación sobre capacidades puntuales.
 */
export const SCOPE_HAS_GRANTS_CODE = 'access.scope_has_grants'
