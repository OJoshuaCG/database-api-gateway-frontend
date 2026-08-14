import { z } from 'zod'
import { engineTypeSchema } from './common'

/**
 * Conversión de collation de una BD completa (feature `collation-conversions`): re-alinea el
 * charset/collation de la BD, sus tablas/columnas y los objetos programables (`ALTER DATABASE`,
 * `CONVERT TO CHARACTER SET`, recreación de vistas/rutinas) hacia un target único. Igual que
 * `database-clones`, el flujo es asíncrono: `execute` valida y ENCOLA un job que un worker
 * ejecuta en segundo plano; la UI sigue el avance por polling de `GET /{id}` y `GET /{id}/items`.
 */

// ── Enums ──────────────────────────────────────────────────────────────────────
export const conversionModeSchema = z.enum(['universal', 'columns'])
export type ConversionMode = z.infer<typeof conversionModeSchema>

export const collationJobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
])
export type CollationJobStatus = z.infer<typeof collationJobStatusSchema>

export const collationJobPhaseSchema = z.enum(['database', 'tables', 'objects', 'done'])
export type CollationJobPhase = z.infer<typeof collationJobPhaseSchema>

export const collationItemStatusSchema = z.enum(['pending', 'ok', 'error', 'skipped'])
export type CollationItemStatus = z.infer<typeof collationItemStatusSchema>

/** Tipo de objeto programable congelado en el plan. `table` NO está acá: las tablas van aparte. */
export const frozenObjectTypeSchema = z.enum(['procedure', 'function', 'trigger', 'event', 'view'])
export type FrozenObjectType = z.infer<typeof frozenObjectTypeSchema>

export const collationStepActionSchema = z.enum([
  'alter_database',
  'convert_table',
  'recreate',
  'convert_columns',
  'skip',
])
export type CollationStepAction = z.infer<typeof collationStepActionSchema>

// ── Entrada ──────────────────────────────────────────────────────────────────────
/** Body de `POST .../collation-conversions`. `target_charset` es condicional según motor. */
export const collationConversionCreateSchema = z.object({
  target_charset: z.string().nullable().optional(),
  target_collation: z.string().min(1, 'Requerido').max(64, 'Máximo 64 caracteres'),
})
export type CollationConversionCreate = z.infer<typeof collationConversionCreateSchema>

export const collationObjectRefSchema = z.object({
  object_type: frozenObjectTypeSchema,
  name: z.string().min(1, 'Requerido').max(512, 'Máximo 512 caracteres'),
})
export type CollationObjectRef = z.infer<typeof collationObjectRefSchema>

/** Body de `POST .../preview`. `tables`/`objects` vacíos + `include_database_default` = universal. */
export const collationConversionPreviewInSchema = z.object({
  tables: z.array(z.string()).optional().default([]),
  objects: z.array(collationObjectRefSchema).optional().default([]),
  include_database_default: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
})
export type CollationConversionPreviewIn = z.infer<typeof collationConversionPreviewInSchema>

/**
 * Body de `POST .../execute`. `confirm_target_name` debe coincidir EXACTO con el nombre real de
 * la BD (doble confirmación); `confirm_token` es el de `preview`, reenviado tal cual.
 */
export const collationConversionExecuteInSchema = z.object({
  confirm_target_name: z.string().min(1, 'Requerido'),
  confirm_token: z.string().min(1, 'Requerido'),
  force: z.boolean().optional().default(false),
})
export type CollationConversionExecuteIn = z.infer<typeof collationConversionExecuteInSchema>

// ── Inventario (`GET .../objects`) ──────────────────────────────────────────────
export const collationColumnOutSchema = z.object({
  name: z.string(),
  data_type: z.string(),
  current_collation: z.string().nullable(),
  is_default_collation: z.boolean(),
})
export type CollationColumnOut = z.infer<typeof collationColumnOutSchema>

export const collationTableOutSchema = z.object({
  name: z.string(),
  charset: z.string().nullable(),
  collation: z.string().nullable(),
  mismatched_columns: z.number().int(),
  needs_conversion: z.boolean(),
  columns: z.array(collationColumnOutSchema).nullable(),
})
export type CollationTableOut = z.infer<typeof collationTableOutSchema>

export const collationGroupOutSchema = z.object({
  charset: z.string().nullable(),
  collation: z.string().nullable(),
  table_count: z.number().int(),
  column_count: z.number().int().nullable(),
})
export type CollationGroupOut = z.infer<typeof collationGroupOutSchema>

/** Fila de `pg_collation` (solo PostgreSQL); `provider` es el código de ICU/libc/builtin. */
export const collationOptionOutSchema = z.object({
  name: z.string(),
  provider: z.enum(['c', 'i', 'b']).nullable(),
  deterministic: z.boolean(),
})
export type CollationOptionOut = z.infer<typeof collationOptionOutSchema>

export const collationObjectOutSchema = z.object({
  object_type: z.string(),
  name: z.string(),
  character_set_client: z.string().nullable(),
  collation_connection: z.string().nullable(),
  database_collation: z.string().nullable(),
  is_outdated: z.boolean(),
})
export type CollationObjectOut = z.infer<typeof collationObjectOutSchema>

/** `data` de `GET .../objects` — inventario completo bajo demanda para el árbol de selección. */
export const collationInventoryOutSchema = z.object({
  job_id: z.number().int(),
  database: z.string(),
  engine: engineTypeSchema,
  mode: conversionModeSchema,
  db_charset: z.string().nullable(),
  db_collation: z.string().nullable(),
  target_charset: z.string().nullable(),
  target_collation: z.string(),
  tables: z.array(collationTableOutSchema),
  summary: z.array(collationGroupOutSchema),
  objects: z.array(collationObjectOutSchema),
  available_collations: z.array(collationOptionOutSchema),
  notes: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type CollationInventoryOut = z.infer<typeof collationInventoryOutSchema>

// ── Preview ──────────────────────────────────────────────────────────────────────
export const collationConversionStepOutSchema = z.object({
  object_type: z.string(),
  object_name: z.string(),
  action: collationStepActionSchema,
  sql: z.string().nullable(),
  reason: z.string().nullable(),
  columns: z.array(z.string()).nullable(),
})
export type CollationConversionStepOut = z.infer<typeof collationConversionStepOutSchema>

/** `data` de `POST .../preview` — plan resuelto SIN ejecutar + `confirm_token` autoritativo. */
export const collationConversionPreviewOutSchema = z.object({
  job_id: z.number().int(),
  database: z.string(),
  mode: conversionModeSchema,
  target_charset: z.string().nullable(),
  target_collation: z.string(),
  include_database_default: z.boolean(),
  steps: z.array(collationConversionStepOutSchema),
  tables_to_convert: z.number().int(),
  tables_skipped: z.number().int(),
  columns_to_convert: z.number().int(),
  objects_to_recreate: z.number().int(),
  missing: z.array(collationObjectRefSchema),
  missing_tables: z.array(z.string()),
  warnings: z.array(z.string()),
  confirm_token: z.string(),
})
export type CollationConversionPreviewOut = z.infer<typeof collationConversionPreviewOutSchema>

// ── Job (crear/leer/ejecutar/cancelar) ──────────────────────────────────────────
export const collationConversionProgressSchema = z.object({
  phase: collationJobPhaseSchema.nullable(),
  tables_done: z.number().int(),
  objects_done: z.number().int(),
})
export type CollationConversionProgress = z.infer<typeof collationConversionProgressSchema>

/** `data` de crear/leer/ejecutar/cancelar — cabecera + estado del job (base del polling). */
export const collationConversionSummaryOutSchema = z.object({
  id: z.number().int(),
  server_id: z.number().int(),
  database_name: z.string(),
  database_id: z.number().int().nullable(),
  engine: engineTypeSchema,
  mode: conversionModeSchema,
  target_charset: z.string().nullable(),
  target_collation: z.string(),
  previous_db_charset: z.string().nullable(),
  previous_db_collation: z.string().nullable(),
  status: collationJobStatusSchema,
  phase: collationJobPhaseSchema.nullable(),
  progress: collationConversionProgressSchema.nullable(),
  error: z.string().nullable(),
  expired: z.boolean(),
  created_at: z.string(),
  expires_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
})
export type CollationConversionSummaryOut = z.infer<typeof collationConversionSummaryOutSchema>

// ── Pasos ejecutados (detalle, paginado) ─────────────────────────────────────────
/**
 * `captured_ddl` NO se incluye: el backend lo persiste (para restaurar grants tras recrear un
 * objeto), pero el serializador de la API nunca lo expone en `GET .../items`.
 */
export const collationConversionItemOutSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  seq: z.number().int(),
  object_type: z.string(),
  object_name: z.string(),
  previous_charset: z.string().nullable(),
  previous_collation: z.string().nullable(),
  status: collationItemStatusSchema.nullable(),
  error: z.string().nullable(),
  grants_captured: z.number().int().nullable(),
  grants_reapplied: z.number().int().nullable(),
  grants_error: z.string().nullable(),
  columns_affected: z.number().int().nullable(),
  execution_ms: z.number().nullable(),
  executed_at: z.string().nullable(),
})
export type CollationConversionItemOut = z.infer<typeof collationConversionItemOutSchema>
