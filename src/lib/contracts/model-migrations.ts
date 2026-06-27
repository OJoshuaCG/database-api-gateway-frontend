import { z } from 'zod'
import { MIGRATION_VERSION_PATTERN, migrationStatusSchema } from './common'

/**
 * Migraciones de blueprint (§8): deltas SQL versionados por blueprint. CRUD de inventario;
 * la aplicación real sobre cada BD vive en §9 (db-migrations). El SQL base se escribe en
 * estilo MySQL y el gateway lo auto-traduce a PostgreSQL (`translated`).
 */

const SQL_MAX = 262144 // 256 KB

/** Traducción cross-engine calculada por el gateway. */
export const migrationTranslatedSchema = z.object({
  mysql: z.string(),
  postgresql: z.string(),
})
export type MigrationTranslated = z.infer<typeof migrationTranslatedSchema>

/** `ModelMigrationOut` — detalle completo de una migración (§8). */
export const modelMigrationOutSchema = z.object({
  id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  up_sql: z.string(),
  up_sql_mysql: z.string().nullable().optional(),
  up_sql_postgresql: z.string().nullable().optional(),
  down_sql: z.string().nullable().optional(),
  down_sql_suggested: z.string().nullable().optional(),
  translated: migrationTranslatedSchema,
  checksum: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ModelMigrationOut = z.infer<typeof modelMigrationOutSchema>

/** `ModelMigrationSummary` — item de listado (§8). */
export const modelMigrationSummarySchema = z.object({
  id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  has_mysql_override: z.boolean(),
  has_postgresql_override: z.boolean(),
  has_rollback: z.boolean(),
  checksum: z.string(),
  created_at: z.string(),
})
export type ModelMigrationSummary = z.infer<typeof modelMigrationSummarySchema>

/** `ModelMigrationCreate` (§8). El `up_sql` es el delta base en estilo MySQL. */
export const modelMigrationCreateSchema = z.object({
  version: z
    .string()
    .regex(MIGRATION_VERSION_PATTERN, 'Solo dígitos, 4–10 (ej. 0001). Se ordena numéricamente.'),
  name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
  up_sql: z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB'),
  up_sql_mysql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  down_sql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
})
export type ModelMigrationCreate = z.infer<typeof modelMigrationCreateSchema>

/**
 * `ModelMigrationPatch` (§8). No se puede modificar el SQL de una migración ya aplicada
 * en alguna BD (`409`).
 */
export const modelMigrationPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  down_sql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_mysql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX).nullable().optional(),
})
export type ModelMigrationPatch = z.infer<typeof modelMigrationPatchSchema>

/** Resultado por BD dentro de `apply-all` (§8). */
export const applyAllItemSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  ok: z.boolean(),
  applied: z
    .array(
      z.object({
        version: z.string(),
        status: migrationStatusSchema,
        execution_ms: z.number().optional(),
      }),
    )
    .optional(),
  pending_versions: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
})
export type ApplyAllItem = z.infer<typeof applyAllItemSchema>

/** Respuesta de `POST .../migrations/apply-all` (§8). */
export const applyAllResultSchema = z.object({
  model_id: z.number().int(),
  total_databases: z.number().int(),
  processed: z.number().int(),
  results: z.array(applyAllItemSchema),
})
export type ApplyAllResult = z.infer<typeof applyAllResultSchema>
