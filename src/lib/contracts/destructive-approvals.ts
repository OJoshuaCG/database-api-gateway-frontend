import { z } from 'zod'

/**
 * Aprobaciones de migraciones destructivas (cuatro ojos).
 *
 * Una migración destructiva no se ejecuta sobre un entorno que bloquea lo destructivo hasta que
 * una SEGUNDA persona la aprueba. La aprobación queda atada al hash del SQL aprobado: si el SQL
 * cambia, deja de valer (`stale_hash`). Espejo de `app/schemas/destructive_approval.py`.
 *
 * Todo campo de vocabulario cerrado se lee como `string` y no como `z.enum`: si el backend suma
 * un valor, un enum duro rechazaría el envelope entero y desaparecería la pantalla completa. La
 * UI degrada mostrando el valor crudo; los formularios sí usan los vocabularios cerrados porque
 * solo envían valores que esta SPA conoce.
 */

export const DESTRUCTIVE_DIRECTIONS = ['up', 'down'] as const
export const destructiveDirectionSchema = z.enum(DESTRUCTIVE_DIRECTIONS)
export type DestructiveDirection = z.infer<typeof destructiveDirectionSchema>

export const DESTRUCTIVE_APPROVAL_SCOPES = ['database', 'blueprint'] as const
export type DestructiveApprovalScope = (typeof DESTRUCTIVE_APPROVAL_SCOPES)[number]

export const APPROVAL_STATUSES = ['approved', 'unapproved', 'revoked', 'stale_hash'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/** Largo del motivo al aprobar y al revocar (mismos límites que el backend). */
export const APPROVAL_REASON_MIN_LENGTH = 10
export const APPROVAL_REASON_MAX_LENGTH = 500

/** Códigos de error nuevos, siempre en `public_context.code`. No existe `already_revoked`. */
export const DESTRUCTIVE_APPROVAL_ERROR_CODES = {
  notFound: 'destructive_approval.not_found',
  notDestructive: 'destructive_approval.not_destructive',
  downSqlMissing: 'destructive_approval.down_sql_missing',
  scopeInvalid: 'destructive_approval.scope_invalid',
  sqlChanged: 'destructive_approval.sql_changed',
  duplicate: 'destructive_approval.duplicate',
  machineActor: 'destructive_approval.machine_actor',
  confirmationRequired: 'destructive_approval.confirmation_required',
  confirmationInvalid: 'destructive_approval.confirmation_invalid',
  confirmationExpired: 'destructive_approval.confirmation_expired',
  confirmPhraseMismatch: 'destructive_approval.confirm_phrase_mismatch',
  batchMultiEnvironment: 'destructive_approval.batch_multi_environment',
  executorForbidden: 'destructive_approval.executor_forbidden',
} as const
export type DestructiveApprovalErrorCode =
  (typeof DESTRUCTIVE_APPROVAL_ERROR_CODES)[keyof typeof DESTRUCTIVE_APPROVAL_ERROR_CODES]

/** 409 de la regla de cuatro ojos; el `rule` del `public_context` dice a quién le toca ceder. */
export const SELF_APPROVAL_FORBIDDEN_CODE = 'access.self_approval_forbidden'
export const SELF_APPROVAL_RULES = ['creator', 'last_editor'] as const
export type SelfApprovalRule = (typeof SELF_APPROVAL_RULES)[number]

/** Persona tal como quedó registrada (snapshot). `null` = desconocida. */
export const actorRefSchema = z.object({
  admin_id: z.number().int().nullish(),
  username: z.string().nullish(),
})
export type ActorRef = z.infer<typeof actorRefSchema>

/** `DestructiveApprovalOut`. */
export const destructiveApprovalSchema = z.object({
  id: z.number().int(),
  model_migration_id: z.number().int(),
  database_model_id: z.number().int(),
  version: z.string(),
  direction: z.string(),
  scope: z.string(),
  managed_database_id: z.number().int().nullish(),
  sql_hash: z.string(),
  hash_basis: z.string(),
  destructive_summary: z.string().nullish(),
  author: actorRefSchema,
  last_sql_editor: actorRefSchema,
  author_unknown: z.boolean(),
  reason: z.string(),
  approved_by: actorRefSchema,
  approved_at: z.string(),
  is_live: z.boolean(),
  revoked_at: z.string().nullish(),
  revoked_by: actorRefSchema.nullish(),
  /** `'superseded'` si la reemplazó una aprobación nueva. */
  revoke_reason: z.string().nullish(),
  last_executed_at: z.string().nullish(),
  last_executed_by: actorRefSchema.nullish(),
  execution_count: z.number().int().optional().default(0),
})
export type DestructiveApproval = z.infer<typeof destructiveApprovalSchema>

/** `DestructiveVersionOut`: una versión destructiva en una dirección, con su estado. */
export const destructiveVersionSchema = z.object({
  migration_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  direction: z.string(),
  /** Hash actual del SQL: es el `expected_sql_hash` al aprobar. */
  sql_hash: z.string(),
  reasons_by_engine: z.record(z.string(), z.array(z.string())).optional().default({}),
  author: actorRefSchema,
  last_sql_editor: actorRefSchema,
  author_unknown: z.boolean(),
  approval_status: z.string(),
  effective_approval_id: z.number().int().nullish(),
  approvals: z.array(destructiveApprovalSchema).optional().default([]),
})
export type DestructiveVersion = z.infer<typeof destructiveVersionSchema>

/** `DestructivePlanVersionOut`: una versión del plan de una base. */
export const destructivePlanVersionSchema = z.object({
  version: z.string(),
  migration_id: z.number().int(),
  sql_hash: z.string(),
  reasons: z.array(z.string()).optional().default([]),
  approval_status: z.string(),
  approval_id: z.number().int().nullish(),
  approval_scope: z.string().nullish(),
})
export type DestructivePlanVersion = z.infer<typeof destructivePlanVersionSchema>

/**
 * `DestructivePlanOut`: plan destructivo de UNA base (dry-run de apply o de rollback). Solo viene
 * cuando el entorno bloquea lo destructivo y hay versiones destructivas en juego.
 */
export const destructivePlanSchema = z.object({
  direction: z.string(),
  requires_confirmation: z.boolean().optional().default(true),
  /** `true` si quien consulta es una persona con `blueprints.apply_destructive` en esta base. */
  executor_allowed: z.boolean(),
  all_approved: z.boolean(),
  versions: z.array(destructivePlanVersionSchema).optional().default([]),
  /** Solo si todo está aprobado Y quien consulta puede ejecutar. TTL 300 s. */
  confirm_token: z.string().nullish(),
  expires_at: z.string().nullish(),
  /** Lo que hay que re-tipear: el nombre de la base. */
  confirm_name_expected: z.string(),
})
export type DestructivePlan = z.infer<typeof destructivePlanSchema>

export const destructiveUnapprovedDatabaseSchema = z.object({
  managed_database_id: z.number().int(),
  versions: z.array(z.string()),
})

/** `DestructiveConfirmationOut`: confirmación a nivel de LOTE de `apply-all`. */
export const destructiveConfirmationSchema = z.object({
  required: z.boolean().optional().default(true),
  confirm_token: z.string().nullish(),
  expires_at: z.string().nullish(),
  /** Lo que hay que re-tipear. `null` si el lote abarca más de un entorno protegido. */
  environment_slug: z.string().nullish(),
  environment_slugs: z.array(z.string()).optional().default([]),
  entry_count: z.number().int().optional().default(0),
  executor_allowed: z.boolean(),
  all_approved: z.boolean(),
  unapproved_databases: z.array(destructiveUnapprovedDatabaseSchema).optional().default([]),
})
export type DestructiveConfirmation = z.infer<typeof destructiveConfirmationSchema>

/** Body de `POST .../destructive-approvals`. */
export interface ApproveDestructiveInput {
  direction: DestructiveDirection
  /** El `sql_hash` que el aprobador revisó. Si el SQL cambió: 409 `sql_changed`. */
  expectedSqlHash: string
  reason: string
}

export const destructiveVersionListSchema = z.array(destructiveVersionSchema)
