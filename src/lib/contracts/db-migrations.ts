import { z } from 'zod'
import { migrationStatusSchema } from './common'

/**
 * Migraciones sobre una BD gestionada (§9): aplica/revierte/consulta las migraciones del
 * blueprint asignado (`model_id`) sobre la BD real. Tocan el motor destino 🔌.
 */

/** `MigrationStatusOut` — versión actual vs. pendientes (§9). */
export const migrationStatusOutSchema = z.object({
  managed_database_id: z.number().int(),
  model_id: z.number().int(),
  slug: z.string(),
  current_version: z.string().nullable(),
  latest_available: z.string().nullable(),
  pending_count: z.number().int(),
  pending_versions: z.array(z.string()),
})
export type MigrationStatusOut = z.infer<typeof migrationStatusOutSchema>

/** Resultado de una sentencia de migración (§9). */
export const migrationRunItemSchema = z.object({
  migration_id: z.number().int(),
  version: z.string(),
  status: migrationStatusSchema,
  error: z.string().nullable().optional(),
  execution_ms: z.number().optional(),
})
export type MigrationRunItem = z.infer<typeof migrationRunItemSchema>

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
  pending_versions: z.array(z.string()).optional().default([]),
  results: z.array(migrationRunItemSchema).optional().default([]),
  // Compatibilidad / campos auxiliares.
  database_name: z.string().optional(),
  server_id: z.number().int().optional(),
  current_version: z.string().nullable().optional(),
  pending_count: z.number().int().optional(),
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
})
export type MigrationRollbackResult = z.infer<typeof migrationRollbackResultSchema>

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
