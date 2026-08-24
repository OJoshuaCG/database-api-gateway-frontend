import { z } from 'zod'
import { migrationStatusSchema } from './common'

/**
 * Migraciones sobre una BD gestionada (§9): aplica/revierte/consulta las migraciones del
 * blueprint asignado (`model_id`) sobre la BD real. Tocan el motor destino 🔌.
 */

/**
 * Entrada de `partial_application[]` (§9, reconciliación): una migración multi-sentencia que
 * falló a mitad dejó `applied_statements` de `total_statements` ejecutadas SIN registrar la
 * versión. `reconcilable: false` viene con `reason`; los campos `null` se omiten del JSON.
 */
export const partialApplicationEntrySchema = z.object({
  version: z.string(),
  model_migration_id: z.number().int(),
  applied_statements: z.number().int(),
  total_statements: z.number().int(),
  reconcilable: z.boolean(),
  reason: z.string().nullish(),
  statements_to_undo: z.number().int().optional().default(0),
})
export type PartialApplicationEntry = z.infer<typeof partialApplicationEntrySchema>

/** `MigrationStatusOut` — versión actual vs. pendientes + aplicación parcial (§9). */
export const migrationStatusOutSchema = z.object({
  managed_database_id: z.number().int(),
  model_id: z.number().int(),
  slug: z.string(),
  /**
   * `false` = la BD **no existe en el motor**: quedó registrada en el inventario sin
   * aprovisionar, o alguien la borró por fuera del gateway. Con esto en `false`,
   * `current_version` es `null` por AUSENCIA (no por "todavía sin migraciones") y
   * `pending_versions` lista todas las del blueprint, así que los contadores mienten si se
   * pintan sin mirar este campo. Todo lo que ejecuta responde 409 hasta aprovisionar.
   *
   * Opcional con default por compatibilidad con backends previos, igual que los campos de
   * reconciliación.
   */
  database_exists: z.boolean().optional().default(true),
  current_version: z.string().nullable(),
  latest_available: z.string().nullable(),
  pending_count: z.number().int(),
  pending_versions: z.array(z.string()),
  // Reconciliación (§9): opcionales con default por compatibilidad con backends previos.
  has_partial_application: z.boolean().optional().default(false),
  partial_application: z.array(partialApplicationEntrySchema).optional().default([]),
})
export type MigrationStatusOut = z.infer<typeof migrationStatusOutSchema>

/**
 * Modo de manejo del fallo a mitad de una migración multi-sentencia (`on_failure`, §9).
 * Solo relevante en MySQL/MariaDB (sin DDL transaccional). Default del backend: `auto`.
 */
export const onFailureModeSchema = z.enum(['auto', 'reconcile', 'leave'])
export type OnFailureMode = z.infer<typeof onFailureModeSchema>

/**
 * Resultado de una migración dentro de `apply`/`rollback` (§9). Los campos de checkpoint
 * (reconciliación) son opcionales: `failed_at_statement_index` es 1-based y `null`/ausente
 * significa que el fallo no es elegible para checkpoint.
 */
export const migrationRunItemSchema = z.object({
  migration_id: z.number().int(),
  version: z.string(),
  status: migrationStatusSchema,
  error: z.string().nullable().optional(),
  execution_ms: z.number().optional(),
  resumed: z.boolean().optional().default(false),
  resumed_from_statement: z.number().int().nullish(),
  statement_total: z.number().int().nullish(),
  failed_at_statement_index: z.number().int().nullish(),
})
export type MigrationRunItem = z.infer<typeof migrationRunItemSchema>

/**
 * Resultado de la reconciliación automática tras un apply fallido (`reconciliation`, §9).
 * `fully_reconciled: true` es el caso feliz: los cambios de la migración fallida se
 * deshicieron y la BD volvió a la versión anterior sin intervención.
 */
export const migrationReconciliationSchema = z.object({
  version: z.string(),
  attempted: z.boolean(),
  undone_count: z.number().int().optional().default(0),
  statements_to_undo: z.number().int().optional().default(0),
  fully_reconciled: z.boolean().optional().default(false),
  unconfirmed_reverses: z.array(z.string()).optional().default([]),
  unreversible_statements: z.array(z.string()).optional().default([]),
  error: z.string().nullish(),
})
export type MigrationReconciliation = z.infer<typeof migrationReconciliationSchema>

/**
 * `MigrationApplyOut` (Plan 09 §7-bis) — respuesta UNIFICADA de `apply`, tanto para la ejecución
 * real como para `dry_run=true`. Una sola llamada lleva de `from_version` a `to_version`
 * aplicando todas las pendientes en orden; `target_version` es lo solicitado (`null` = última).
 *
 * Campos en `.optional()` con `default`: el backend puede omitirlos (p. ej. en un dry-run) y se
 * rellenan con un valor seguro. `database_name`/`server_id`/`current_version`/`pending_count` se
 * mantienen opcionales por compatibilidad con respuestas previas a Plan 09.
 */
export const migrationApplyOutSchema = z.object({
  managed_database_id: z.number().int(),
  from_version: z.string().nullable().optional(),
  to_version: z.string().nullable().optional(),
  target_version: z.string().nullable().optional(),
  applied_count: z.number().int().optional().default(0),
  no_op: z.boolean().optional().default(false),
  failed: z.boolean().optional().default(false),
  quarantined: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false),
  /**
   * Solo en dry-run: `false` = la BD no existe en el motor. El dry-run informa y no falla —es
   * la llamada de diagnóstico— pero fuerza `no_op`; el apply real responde 409
   * `managed_database.not_provisioned`.
   */
  database_exists: z.boolean().optional().default(true),
  pending_versions: z.array(z.string()).optional().default([]),
  results: z.array(migrationRunItemSchema).optional().default([]),
  /** Reconciliación automática de la migración fallida (§9); `null`/ausente = no aplicó. */
  reconciliation: migrationReconciliationSchema.nullish(),
  // Compatibilidad / campos auxiliares.
  // `.nullish()` y no `.optional()`: el backend los tipa `str | None` / `int | None`, y
  // `.optional()` NO acepta `null` (los None anidados no los filtra el envelope). Mismo defecto
  // que tenía `applyAllItemSchema`.
  database_name: z.string().nullish(),
  server_id: z.number().int().nullish(),
  /** Entorno de esta BD; `null` si no está clasificada. */
  environment_slug: z.string().nullish(),
  /**
   * Solo en dry-run: versiones pendientes que el entorno bloquearía por ser destructivas.
   * INFORMATIVO — el dry-run no falla, justamente para que se pueda ver qué frena el apply.
   */
  blocked_by: z.array(z.string()).optional().default([]),
  current_version: z.string().nullable().optional(),
  pending_count: z.number().int().optional(),
  /**
   * Captura de resultados de SELECT (api-reference-v9 §3.2): filas escritas por ESTA corrida
   * (no un acumulado histórico), y si hay algo para leer en §3.5. `select_results_available:
   * true` NO garantiza `row_count > 0` — un SELECT sin filas también queda "disponible".
   */
  captured_select_count: z.number().int().optional().default(0),
  select_results_available: z.boolean().optional().default(false),
})
export type MigrationApplyOut = z.infer<typeof migrationApplyOutSchema>

/** Alias histórico: el shape de `apply` ahora es único (dry-run o real). */
export const migrationApplyResultSchema = migrationApplyOutSchema
export type MigrationApplyResult = MigrationApplyOut
/** @deprecated El shape de dry-run y real es el mismo (`MigrationApplyOut`). */
export type MigrationApplyDryRun = MigrationApplyOut

/** Discrimina la respuesta de `apply`: `true` si fue una previsualización (no mutó nada). */
export function isDryRunResult(result: MigrationApplyResult): boolean {
  return result.dry_run === true
}

/**
 * `MigrationRollbackOut` (Plan 09 §7-bis) — el rollback es el espejo de `apply`: en una sola
 * llamada revierte secuencialmente de `from_version` hasta `target_version` (anterior a la
 * actual). `reverted_versions` va de la más reciente a la más antigua.
 */
export const migrationRollbackResultSchema = z.object({
  managed_database_id: z.number().int(),
  from_version: z.string().nullable().optional(),
  to_version: z.string().nullable().optional(),
  target_version: z.string().nullable().optional(),
  reverted_count: z.number().int().optional().default(0),
  reverted_versions: z.array(z.string()).optional().default([]),
  no_op: z.boolean().optional().default(false),
  failed: z.boolean().optional().default(false),
  quarantined: z.boolean().optional().default(false),
  results: z.array(migrationRunItemSchema).optional().default([]),
  /** Ver `migrationApplyOutSchema` — idénticos en `rollback` (api-reference-v9 §3.3). */
  captured_select_count: z.number().int().optional().default(0),
  select_results_available: z.boolean().optional().default(false),
})
export type MigrationRollbackResult = z.infer<typeof migrationRollbackResultSchema>

/** Sentencia de reverso del plan de reconciliación (dry-run de `reconcile-partial`, §9). */
export const reconcileStatementSchema = z.object({
  seq: z.number().int(),
  sql: z.string(),
})
export type ReconcileStatement = z.infer<typeof reconcileStatementSchema>

/**
 * Resultado por sentencia de la ejecución real de `reconcile-partial` (§9). El shape por
 * sentencia no está documentado con detalle; campos opcionales por robustez (mismo criterio
 * que `migrationStampResultSchema`).
 */
export const reconcileStatementResultSchema = z.object({
  seq: z.number().int().optional(),
  sql: z.string().optional(),
  ok: z.boolean().optional(),
  status: z.string().optional(),
  error: z.string().nullish(),
  execution_ms: z.number().optional(),
})
export type ReconcileStatementResult = z.infer<typeof reconcileStatementResultSchema>

/**
 * Respuesta de `POST .../migrations/reconcile-partial` (§9), unificada para dry-run y
 * ejecución real (mismo criterio que `migrationApplyOutSchema`). Con `dry_run: true` llegan
 * el plan (`statements`, por `seq`) y los avisos; con `dry_run: false` se suman
 * `undone_count` / `failed` / `fully_reconciled` / `remaining_applied_statements` / `results`.
 *
 * ⚠️ El backend valida `force` ANTES de `dry_run`: si hay sentencias sin reverso y no se pasó
 * `force=true`, responde 409 INCLUSO en dry-run, con `public_context.unreversible_statements`
 * (ver `ApiError.unreversibleStatements`).
 */
export const reconcilePartialResultSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string().optional(),
  server_id: z.number().int().optional(),
  version: z.string(),
  applied_statements: z.number().int().optional().default(0),
  total_statements: z.number().int().optional().default(0),
  statements_to_undo: z.number().int().optional().default(0),
  unreversible_statements: z.array(z.string()).optional().default([]),
  unconfirmed_reverses: z.array(z.string()).optional().default([]),
  dry_run: z.boolean().optional().default(false),
  statements: z.array(reconcileStatementSchema).optional().default([]),
  // Solo en la ejecución real (`dry_run=false`); ausentes en el plan.
  undone_count: z.number().int().optional(),
  failed: z.boolean().optional(),
  fully_reconciled: z.boolean().optional(),
  remaining_applied_statements: z.number().int().optional(),
  results: z.array(reconcileStatementResultSchema).optional().default([]),
})
export type ReconcilePartialResult = z.infer<typeof reconcilePartialResultSchema>

/**
 * Respuesta de `stamp` (§9). Marca una versión sin ejecutar SQL; el shape no está
 * documentado con detalle, por eso los campos son opcionales (robustez ante el contrato).
 */
export const migrationStampResultSchema = z.object({
  managed_database_id: z.number().int().optional(),
  version: z.string().optional(),
  current_version: z.string().nullable().optional(),
})
export type MigrationStampResult = z.infer<typeof migrationStampResultSchema>

/** Item del historial de aplicaciones (§9). */
export const migrationHistoryItemSchema = z.object({
  id: z.number().int(),
  managed_database_id: z.number().int(),
  model_migration_id: z.number().int(),
  version: z.string(),
  applied_at: z.string(),
  status: migrationStatusSchema,
  error: z.string().nullable().optional(),
  execution_ms: z.number().optional(),
})
export type MigrationHistoryItem = z.infer<typeof migrationHistoryItemSchema>
