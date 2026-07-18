import { z } from 'zod'
import { engineTypeSchema } from './common'

/**
 * Clonado de bases de datos entre servidores (feature `database-clones`): copia la estructura y,
 * opcionalmente, TODOS los datos de una BD origen hacia una BD destino en cualquier servidor,
 * mismo motor o distinto, con origen/destino adoptados o crudos y destino nuevo o existente.
 * El flujo es asíncrono: `execute` valida y ENCOLA un job que un worker ejecuta en segundo plano;
 * la UI sigue el avance por polling de `GET /{id}` y `GET /{id}/items`.
 */

// ── Enums ──────────────────────────────────────────────────────────────────────
export const cloneObjectTypeSchema = z.enum([
  'table',
  'view',
  'materialized_view',
  'routine',
  'trigger',
  'sequence',
  'enum_type',
  'extension',
  'event',
])
export type CloneObjectType = z.infer<typeof cloneObjectTypeSchema>

export const cloneTargetModeSchema = z.enum(['new', 'existing'])
export type CloneTargetMode = z.infer<typeof cloneTargetModeSchema>

export const cloneCleanModeSchema = z.enum(['none', 'objects', 'drop_database'])
export type CloneCleanMode = z.infer<typeof cloneCleanModeSchema>

export const cloneStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
])
export type CloneStatus = z.infer<typeof cloneStatusSchema>

export const clonePhaseSchema = z.enum(['clean', 'structure', 'data', 'adopt', 'done'])
export type ClonePhase = z.infer<typeof clonePhaseSchema>

export const cloneItemKindSchema = z.enum(['clean', 'structure', 'data', 'adopt'])
export type CloneItemKind = z.infer<typeof cloneItemKindSchema>

export const cloneItemStatusSchema = z.enum(['pending', 'applied', 'failed', 'skipped'])
export type CloneItemStatus = z.infer<typeof cloneItemStatusSchema>

export const cloneDependencyReasonSchema = z.enum(['foreign_key', 'trigger_table', 'body_reference'])
export type CloneDependencyReason = z.infer<typeof cloneDependencyReasonSchema>

// ── Objetos y dependencias ───────────────────────────────────────────────────────
export const cloneObjectRefSchema = z.object({
  object_type: cloneObjectTypeSchema,
  name: z.string().min(1, 'Requerido').max(512, 'Máximo 512 caracteres'),
})
export type CloneObjectRef = z.infer<typeof cloneObjectRefSchema>

/** Objeto del inventario del origen (o de `skipped` en el preview). */
export const cloneObjectOutSchema = z.object({
  object_type: cloneObjectTypeSchema,
  name: z.string(),
  portable: z.boolean(),
  portability_reason: z.string().nullable(),
  row_estimate: z.number().int().nullable(),
})
export type CloneObjectOut = z.infer<typeof cloneObjectOutSchema>

/** Arista del grafo de dependencias. `authoritative: true` = FK/trigger (se agrega solo al cierre). */
export const cloneDependencyEdgeOutSchema = z.object({
  from_type: cloneObjectTypeSchema,
  from_name: z.string(),
  to_type: cloneObjectTypeSchema,
  to_name: z.string(),
  reason: cloneDependencyReasonSchema,
  authoritative: z.boolean(),
})
export type CloneDependencyEdgeOut = z.infer<typeof cloneDependencyEdgeOutSchema>

/** `data` de `GET .../objects` — inventario del origen para el árbol de selección. */
export const cloneInventoryOutSchema = z.object({
  objects: z.array(cloneObjectOutSchema),
  authoritative_edges: z.array(cloneDependencyEdgeOutSchema),
  advisory_edges: z.array(cloneDependencyEdgeOutSchema),
  cross_engine: z.boolean(),
  scope_note: z.string().nullable().optional(),
})
export type CloneInventoryOut = z.infer<typeof cloneInventoryOutSchema>

/** Body de `POST .../resolve-selection`. */
export const cloneResolveSelectionInSchema = z.object({
  selection: z.array(cloneObjectRefSchema).min(1, 'Selecciona al menos un objeto'),
})
export type CloneResolveSelectionIn = z.infer<typeof cloneResolveSelectionInSchema>

/** `data` de `POST .../resolve-selection` — cierre de dependencias resuelto. */
export const cloneClosureOutSchema = z.object({
  selected: z.array(cloneObjectRefSchema),
  added: z.array(cloneObjectRefSchema),
  closure: z.array(cloneObjectRefSchema),
  edges: z.array(cloneDependencyEdgeOutSchema),
  advisory: z.array(cloneDependencyEdgeOutSchema),
  table_order: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type CloneClosureOut = z.infer<typeof cloneClosureOutSchema>

// ── Plan (creación) ──────────────────────────────────────────────────────────────
/**
 * Body de `POST /database-clones`. Origen: EXACTAMENTE una representación
 * (`source_database_id` — BD del inventario — O `source_server_id`+`source_database_name` — BD
 * cruda). Destino: siempre por servidor+nombre; `target_mode` decide si se crea (`new`) o se usa
 * uno ya existente (`existing`). `selection: null` = clon completo (comportamiento por defecto de
 * este asistente: la selección parcial real se resuelve y persiste vía `preview`, no aquí).
 */
export const cloneCreateInSchema = z.object({
  source_database_id: z.number().int().min(1).nullable().optional(),
  source_server_id: z.number().int().min(1).nullable().optional(),
  source_database_name: z.string().min(1).max(64).nullable().optional(),
  target_server_id: z.number().int().min(1),
  target_database_name: z.string().min(1, 'Requerido').max(64, 'Máximo 64 caracteres'),
  target_database_id: z.number().int().min(1).nullable().optional(),
  target_mode: cloneTargetModeSchema,
  include_data: z.boolean().optional().default(false),
  clean_mode: cloneCleanModeSchema.optional().default('none'),
  adopt_target: z.boolean().optional().default(false),
  adopt_owner_id: z.number().int().min(1).nullable().optional(),
  selection: z.array(cloneObjectRefSchema).nullable().optional(),
})
export type CloneCreateIn = z.infer<typeof cloneCreateInSchema>

/**
 * `data` de crear/leer/ejecutar/cancelar — cabecera + estado del job (base del polling).
 * `source_database_id`/`target_database_id` son `null` cuando ese lado no está en el inventario
 * del gateway; el resto de la identidad física (`*_server_id`/`*_database_name`/`*_engine`)
 * SIEMPRE viene poblada, sea cual sea la forma en que se mandó ese lado.
 */
export const cloneProgressSchema = z.object({
  phase: z.string(),
  tables: z.record(z.string(), z.number().int()),
})
export type CloneProgress = z.infer<typeof cloneProgressSchema>

export const cloneSummaryOutSchema = z.object({
  id: z.number().int(),
  source_server_id: z.number().int(),
  source_database_name: z.string(),
  source_database_id: z.number().int().nullable(),
  source_engine: engineTypeSchema,
  target_server_id: z.number().int(),
  target_database_name: z.string(),
  target_database_id: z.number().int().nullable(),
  target_engine: engineTypeSchema,
  target_mode: cloneTargetModeSchema,
  include_data: z.boolean(),
  clean_mode: cloneCleanModeSchema,
  adopt_target: z.boolean(),
  cross_engine: z.boolean(),
  status: cloneStatusSchema,
  phase: clonePhaseSchema.nullable(),
  progress: cloneProgressSchema.nullable(),
  error: z.string().nullable(),
  expired: z.boolean(),
  created_at: z.string(),
  expires_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
})
export type CloneSummaryOut = z.infer<typeof cloneSummaryOutSchema>

// ── Preview ──────────────────────────────────────────────────────────────────────
/** Body de `POST .../preview`. `selection: null` = clon completo; si no, REEMPLAZA y re-persiste. */
export const clonePreviewInSchema = z.object({
  selection: z.array(cloneObjectRefSchema).nullable().optional(),
})
export type ClonePreviewIn = z.infer<typeof clonePreviewInSchema>

export const clonePreviewStatementOutSchema = z.object({
  kind: z.enum(['clean', 'structure']),
  object_type: z.string(),
  object_name: z.string(),
  sql: z.string(),
})
export type ClonePreviewStatementOut = z.infer<typeof clonePreviewStatementOutSchema>

export const clonePreviewDataTableOutSchema = z.object({
  table: z.string(),
  row_estimate: z.number().int().nullable(),
  upsert: z.boolean(),
})
export type ClonePreviewDataTableOut = z.infer<typeof clonePreviewDataTableOutSchema>

/** `data` de `POST .../preview` — plan resuelto SIN ejecutar + `confirm_token` autoritativo. */
export const clonePreviewOutSchema = z.object({
  job_id: z.number().int(),
  target_database_id: z.number().int().nullable(),
  cross_engine: z.boolean(),
  clean_statements: z.array(clonePreviewStatementOutSchema),
  structure_statements: z.array(clonePreviewStatementOutSchema),
  data_tables: z.array(clonePreviewDataTableOutSchema),
  skipped: z.array(cloneObjectOutSchema),
  will_adopt: z.boolean(),
  warnings: z.array(z.string()),
  confirm_token: z.string(),
})
export type ClonePreviewOut = z.infer<typeof clonePreviewOutSchema>

// ── Execute ──────────────────────────────────────────────────────────────────────
/**
 * Body de `POST .../execute`. `confirm_target_name` debe coincidir EXACTO con el nombre real del
 * destino (doble confirmación); `confirm_token` es el de `preview`, reenviado tal cual.
 */
export const cloneExecuteInSchema = z.object({
  confirm_target_name: z.string().min(1, 'Requerido'),
  confirm_token: z.string().min(1, 'Requerido'),
  force: z.boolean().optional().default(false),
})
export type CloneExecuteIn = z.infer<typeof cloneExecuteInSchema>

// ── Pasos ejecutados (detalle, paginado) ─────────────────────────────────────────
export const cloneItemOutSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  seq: z.number().int(),
  kind: cloneItemKindSchema,
  object_type: z.string(),
  object_name: z.string(),
  status: cloneItemStatusSchema.nullable(),
  error: z.string().nullable(),
  rows_copied: z.number().int().nullable(),
  execution_ms: z.number().nullable(),
  executed_at: z.string().nullable(),
})
export type CloneItemOut = z.infer<typeof cloneItemOutSchema>
