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

  // ── Pertenencia al lote y totales (v17 §2) ───────────────────────────────────
  // Aditivos y los cuatro nullable: son `null` en una conversión suelta, y también mientras el
  // job no se haya previsualizado.
  /** Lote al que pertenece, o `null` si es una conversión suelta. Permite volver al lote. */
  batch_id: z.number().int().nullable(),
  /**
   * Posición **1-based** dentro del lote. Los jobs corren EN SERIE, así que es lo único que
   * permite decir "la 4 de 12" y ordenar la tabla de forma estable: el `status` por sí solo no
   * distingue "en cola" de "ya terminada" en un orden reproducible.
   */
  batch_seq: z.number().int().nullable(),
  /**
   * Denominador que faltaba: `progress` solo cuenta lo HECHO y nunca el total. Antes la SPA lo
   * parcheaba guardando los totales del preview en estado de React, que se perdía al recargar
   * justo en una operación que dura horas. Ahora viene del servidor y sobrevive la recarga.
   */
  tables_total: z.number().int().nullable(),
  objects_total: z.number().int().nullable(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// Lote por blueprint, versión de contabilidad y deriva (v17)
// ═══════════════════════════════════════════════════════════════════════════════
//
// NULABILIDAD — la regla que gobierna todo lo de abajo:
//
// `ApiResponse` filtra los `None` **solo del envelope**. Los `None` anidados dentro de `data`
// salen como `null` EXPLÍCITO, y Zod `.optional()` rechaza `null`. Por eso cada campo que el
// contrato marca `| null` va `.nullable()`, nunca `.optional()`. Es la causa raíz de
// `T-260822-lz-contratos-nullish`. Y el `safeParse` corre sobre el envelope completo: una
// divergencia de UN campo cuesta la respuesta ENTERA.

// ── Lote: enums ────────────────────────────────────────────────────────────────
export const collationBatchStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'failed',
  'canceled',
])
export type CollationBatchStatus = z.infer<typeof collationBatchStatusSchema>

/** `all_tables` se resuelve contra el inventario PROPIO de cada BD, no contra una lista común. */
export const collationBatchScopeSchema = z.enum(['all_tables', 'explicit'])
export type CollationBatchScope = z.infer<typeof collationBatchScopeSchema>

/**
 * `none` deja los objetos programables congelados con la collation vieja — que es exactamente el
 * `Illegal mix of collations` que esta herramienta existe para evitar. El preview lo avisa por
 * `warnings`, y esos warnings hay que mostrarlos.
 */
export const collationBatchObjectsSchema = z.enum(['all', 'none'])
export type CollationBatchObjects = z.infer<typeof collationBatchObjectsSchema>

// ── Lote: planificar (`POST /database-models/{id}/collation-conversions`) ───────
export const collationBatchCreateSchema = z.object({
  target_charset: z.string().nullable().optional(),
  target_collation: z.string().min(1, 'Requerido').max(64, 'Máximo 64 caracteres'),
  scope: collationBatchScopeSchema.optional().default('all_tables'),
  tables: z.array(z.string()).optional().default([]),
  objects: collationBatchObjectsSchema.optional().default('all'),
  include_database_default: z.boolean().optional().default(true),
  environment_id: z.number().int().nullable().optional(),
  max_databases: z
    .number()
    .int()
    .min(1, 'Mínimo 1')
    .max(100, 'Máximo 100')
    .optional()
    .default(10),
})
export type CollationBatchCreate = z.infer<typeof collationBatchCreateSchema>

/**
 * Una BD dentro del plan del lote.
 *
 * Misma forma que `ApplyAllItemOut` a propósito: el frontend no aprende una segunda forma de
 * ítem-por-BD. `ok:false` + `error_code` clasifica el rechazo (ver `classifyBatchItem`).
 */
export const collationBatchDatabaseOutSchema = z.object({
  managed_database_id: z.number().int(),
  server_id: z.number().int(),
  database_name: z.string(),
  batch_seq: z.number().int(),
  job_id: z.number().int().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
  error_code: z.string().nullable(),
  tables_to_convert: z.number().int(),
  objects_to_recreate: z.number().int(),
  include_database_default: z.boolean(),
  missing_tables: z.array(z.string()),
  warnings: z.array(z.string()),
  confirm_token: z.string().nullable(),
})
export type CollationBatchDatabaseOut = z.infer<typeof collationBatchDatabaseOutSchema>

/** `data` de planificar el lote: un job por BD activa, ya previsualizado, + `batch_token`. */
export const collationBatchPlanOutSchema = z.object({
  batch_id: z.number().int(),
  model_id: z.number().int(),
  /** Hay que reenviarlo tal cual en `/execute` como `confirm_model_slug`. */
  model_slug: z.string(),
  target_charset: z.string().nullable(),
  target_collation: z.string(),
  /** BDs activas del blueprint ANTES de aplicar el tope. */
  total_eligible: z.number().int(),
  max_databases: z.number().int(),
  /**
   * `true` si el tope dejó BDs elegibles afuera. **Se muestra o se miente**: silenciarlo haría
   * creer al operador que convirtió el blueprint entero.
   */
  capped: z.boolean(),
  batch_token: z.string(),
  /** TTL del plan (24 h por default). Vencido → 410. */
  expires_at: z.string(),
  /** Siempre `true` hoy: 1 worker por default, así que un lote de 12 tarda horas. */
  runs_serially: z.boolean(),
  databases: z.array(collationBatchDatabaseOutSchema),
})
export type CollationBatchPlanOut = z.infer<typeof collationBatchPlanOutSchema>

// ── Lote: ejecutar (`POST .../{batch_id}/execute`) ─────────────────────────────
/**
 * Un lote reemplaza N re-tipeos por uno, y el contrato REPONE el control pidiendo cuatro cosas
 * juntas. El `batch_token` lo genera el servidor, así que aporta FRESCURA, no INTENCIÓN.
 */
export const collationBatchExecuteInSchema = z.object({
  confirm_model_slug: z.string().min(1, 'Requerido'),
  confirm_token: z.string().min(1, 'Requerido'),
  /**
   * El conjunto previsualizado, echado de vuelta. Cualquier diferencia es 422 fail-closed: el
   * backend NO recorta ni amplía.
   */
  database_ids: z.array(z.number().int()),
  /**
   * `managed_database_id` (como string) → nombre exacto re-tipeado. Obligatorio para toda BD cuyo
   * entorno tenga `blocks_destructive_migrations`.
   */
  confirmations: z.record(z.string(), z.string()).optional().default({}),
  /** Override de cuarentena y de drift de inventario, por BD. NO amplía el conjunto ni saltea el re-tipeo. */
  force: z.boolean().optional().default(false),
})
export type CollationBatchExecuteIn = z.infer<typeof collationBatchExecuteInSchema>

export const collationBatchExecuteResultSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  job_id: z.number().int().nullable(),
  batch_seq: z.number().int(),
  ok: z.boolean(),
  error: z.string().nullable(),
  error_code: z.string().nullable(),
})
export type CollationBatchExecuteResult = z.infer<typeof collationBatchExecuteResultSchema>

/**
 * `data` de ejecutar. Llega **200 aunque alguna BD se rechace**: los rechazos por BD viajan
 * adentro, en `results[].ok`. Un rechazo DEL LOTE (slug, conjunto, re-tipeo, token, estado) es
 * 422/409 y no encola nada.
 */
export const collationBatchExecuteOutSchema = z.object({
  batch_id: z.number().int(),
  model_id: z.number().int(),
  enqueued: z.number().int(),
  runs_serially: z.boolean(),
  results: z.array(collationBatchExecuteResultSchema),
})
export type CollationBatchExecuteOut = z.infer<typeof collationBatchExecuteOutSchema>

// ── Lote: estado (`GET`/`POST .../cancel`) ─────────────────────────────────────
/**
 * Agregado del lote. Existe para no recorrer N filas en cada tick del polling.
 *
 * `done`/`failed` se DERIVAN al leer: ningún worker los escribe (que cada uno consultara a sus
 * hermanos para saber si es el último sería una carrera).
 */
export const collationBatchCountsOutSchema = z.object({
  total: z.number().int(),
  queued: z.number().int(),
  running: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  canceled: z.number().int(),
})
export type CollationBatchCountsOut = z.infer<typeof collationBatchCountsOutSchema>

export const collationBatchSummaryOutSchema = z.object({
  batch_id: z.number().int(),
  model_id: z.number().int(),
  target_charset: z.string().nullable(),
  target_collation: z.string(),
  status: collationBatchStatusSchema,
  error: z.string().nullable(),
  total: z.number().int(),
  max_databases: z.number().int(),
  capped: z.boolean(),
  /** Versión de contabilidad ya creada para este lote, si se creó. */
  blueprint_version_id: z.number().int().nullable(),
  created_by_username: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  runs_serially: z.boolean(),
  counts: collationBatchCountsOutSchema,
})
export type CollationBatchSummaryOut = z.infer<typeof collationBatchSummaryOutSchema>

/** `data` del polling del lote y de cancelar. **No paginado.** */
export const collationBatchStatusOutSchema = z.object({
  batch: collationBatchSummaryOutSchema,
  jobs: z.array(collationConversionSummaryOutSchema),
})
export type CollationBatchStatusOut = z.infer<typeof collationBatchStatusOutSchema>

// ── Versión de contabilidad (`POST .../{batch_id}/blueprint-version`) ──────────
export const collationBlueprintVersionInSchema = z.object({
  name: z.string().max(200, 'Máximo 200 caracteres').nullable().optional(),
})
export type CollationBlueprintVersionIn = z.infer<typeof collationBlueprintVersionInSchema>

export const collationVersionStampOutSchema = z.object({
  managed_database_id: z.number().int(),
  ok: z.boolean(),
  error: z.string().nullable(),
})
export type CollationVersionStampOut = z.infer<typeof collationVersionStampOutSchema>

/**
 * `data` de crear la versión. **Se STAMPEA, no se aplica** — `note` lo dice y va mostrado tal
 * cual: una BD agregada al blueprint DESPUÉS la tendrá pendiente, y aplicarla le convertiría las
 * tablas sin recrearle los objetos con la collation congelada.
 *
 * `pending_stamp` son las BDs cuyo `stamp` falló. **La versión no se borra**: existe y es
 * correcta; lo que falta es la marca de esas bases, que se pone a mano con `/migrations/stamp`.
 */
export const collationBlueprintVersionOutSchema = z.object({
  batch_id: z.number().int(),
  model_id: z.number().int(),
  version: z.number().int(),
  migration_id: z.number().int(),
  statement_count: z.number().int(),
  stamped: z.array(collationVersionStampOutSchema),
  pending_stamp: z.array(z.number().int()),
  note: z.string(),
})
export type CollationBlueprintVersionOut = z.infer<typeof collationBlueprintVersionOutSchema>

// ── Deriva (`GET /database-models/{id}/collation-drift`) ───────────────────────
/**
 * `unknown` **NO es `ok`**: pintarlos igual le diría al operador que todo está bien sobre bases
 * de las que no se sabe nada. `not_applicable` es PostgreSQL, donde el concepto es
 * `encoding` + `lc_collate`, que no son equivalentes.
 */
export const collationDriftStatusSchema = z.enum([
  'ok',
  'drifted',
  'unknown',
  'undeclared',
  'not_applicable',
])
export type CollationDriftStatus = z.infer<typeof collationDriftStatusSchema>

/**
 * De dónde sale el dato. Importa porque `charset`/`collation` siguen siendo escribibles a mano
 * por `PATCH /managed-databases/{id}`: una fila puede decir `ok` porque alguien lo tipeó, sin que
 * nadie haya leído el motor (deuda `T-260824-lz-charset-managed-patch`).
 */
export const collationDriftSourceOfTruthSchema = z.enum(['adopted', 'provisioned', 'unknown'])
export type CollationDriftSourceOfTruth = z.infer<typeof collationDriftSourceOfTruthSchema>

export const collationDriftRowOutSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  server_name: z.string(),
  engine: engineTypeSchema,
  environment_slug: z.string().nullable(),
  charset: z.string().nullable(),
  collation: z.string().nullable(),
  status: collationDriftStatusSchema,
  source_of_truth: collationDriftSourceOfTruthSchema,
})
export type CollationDriftRowOut = z.infer<typeof collationDriftRowOutSchema>

/** `data` de la deriva. **Sin rate limit: no abre ninguna conexión al motor.** */
export const collationDriftOutSchema = z.object({
  model_id: z.number().int(),
  model_slug: z.string(),
  /** La declaración del blueprint, o `null` si nunca se declaró. Se escribe con `PATCH /database-models/{id}`. */
  declared: z
    .object({ charset: z.string().nullable(), collation: z.string().nullable() })
    .nullable(),
  source: z.literal('cached'),
  /** **Se muestra TEXTUAL.** Es una caché, no el motor, y esta pantalla decide conversiones. */
  source_note: z.string(),
  databases: z.array(collationDriftRowOutSchema),
})
export type CollationDriftOut = z.infer<typeof collationDriftOutSchema>
