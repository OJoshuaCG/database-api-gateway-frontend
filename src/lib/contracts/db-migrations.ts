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

/** Respuesta de `apply?dry_run=true` — plan sin ejecutar (§9). */
export const migrationApplyDryRunSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  dry_run: z.literal(true),
  current_version: z.string().nullable(),
  pending_versions: z.array(z.string()),
  pending_count: z.number().int(),
})
export type MigrationApplyDryRun = z.infer<typeof migrationApplyDryRunSchema>

/** Respuesta de `apply` real (§9). */
export const migrationApplyRunSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  applied_count: z.number().int(),
  failed: z.boolean(),
  quarantined: z.boolean(),
  results: z.array(migrationRunItemSchema),
})
export type MigrationApplyRun = z.infer<typeof migrationApplyRunSchema>

/** Respuesta de `apply` — dry-run o ejecución real (§9). */
export const migrationApplyResultSchema = z.union([
  migrationApplyDryRunSchema,
  migrationApplyRunSchema,
])
export type MigrationApplyResult = z.infer<typeof migrationApplyResultSchema>

/** Discrimina la respuesta de `apply` entre plan (dry-run) y ejecución real. */
export function isDryRunResult(result: MigrationApplyResult): result is MigrationApplyDryRun {
  return 'dry_run' in result && result.dry_run === true
}

/** Respuesta de `rollback` (§9). */
export const migrationRollbackResultSchema = z.object({
  managed_database_id: z.number().int(),
  rolled_back_version: z.string(),
  current_version: z.string().nullable(),
  result: migrationRunItemSchema,
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
