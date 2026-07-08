import { z } from 'zod'
import {
  engineTypeSchema,
  migrationKindSchema,
  MIGRATION_VERSION_PATTERN,
  migrationStatusSchema,
} from './common'

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

/**
 * `ModelMigrationOut` — detalle completo de una migración (§8). Plan 09 añade los campos de
 * baseline de snapshot: `source_engine`, `is_baseline`, `has_non_portable` y `reviewed`
 * (un baseline de snapshot nace `reviewed=false` y no se puede aplicar hasta aprobarlo).
 */
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
  source_engine: engineTypeSchema.nullable().optional(),
  kind: migrationKindSchema.optional(),
  is_baseline: z.boolean().optional(),
  has_non_portable: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ModelMigrationOut = z.infer<typeof modelMigrationOutSchema>

/**
 * `ModelMigrationSummary` — item de listado (§8). Los campos de baseline (`is_baseline`,
 * `has_non_portable`, `reviewed`) son opcionales: si el backend los incluye en el resumen, la
 * lista puede mostrar los badges sin pedir el detalle de cada versión.
 */
export const modelMigrationSummarySchema = z.object({
  id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  has_mysql_override: z.boolean(),
  has_postgresql_override: z.boolean(),
  has_rollback: z.boolean(),
  kind: migrationKindSchema.optional(),
  is_baseline: z.boolean().optional(),
  has_non_portable: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  checksum: z.string(),
  created_at: z.string(),
})
export type ModelMigrationSummary = z.infer<typeof modelMigrationSummarySchema>

/**
 * `ModelMigrationCreate` (§8 / Plan 09 §7-ter). El `up_sql` es el delta base en estilo MySQL.
 * `version` es **opcional**: si se omite, el gateway asigna la siguiente secuencial (max+1) de
 * forma autónoma y con reintento ante colisión. Pásala solo para fijarla a mano.
 */
export const modelMigrationCreateSchema = z.object({
  version: z
    .string()
    .regex(MIGRATION_VERSION_PATTERN, 'Solo dígitos, 4–10 (ej. 0001). Se ordena numéricamente.')
    .optional(),
  name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
  up_sql: z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB'),
  up_sql_mysql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  down_sql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
})
export type ModelMigrationCreate = z.infer<typeof modelMigrationCreateSchema>

/**
 * `ModelMigrationPatch` (§8 / Plan 09 §7-ter / Cambio 2). Se puede corregir el `up_sql` de una
 * migración **mientras no se haya aplicado con éxito** en ninguna BD (si ya se aplicó, `409` que
 * sugiere fix-forward). Al cambiar `up_sql`, el backend regenera `down_sql_suggested` y recalcula
 * `checksum`, y exige reenviar corregidos o limpiar con `null` los overrides por motor (si no,
 * `409` de overrides obsoletos). `name`/`down_sql`/overrides/`reviewed` no tienen esa restricción;
 * `reviewed:true` aprueba un baseline de snapshot para que pueda aplicarse (R1).
 */
export const modelMigrationPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  up_sql: z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB').optional(),
  down_sql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_mysql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX).nullable().optional(),
  reviewed: z.boolean().optional(),
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
