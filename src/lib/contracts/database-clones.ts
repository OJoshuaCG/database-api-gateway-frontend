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

/** Qué copia el job. Es un eje propio: `include_data` (booleano) es el atajo legacy que se deriva a esto. */
export const cloneCopyIntentSchema = z.enum(['structure_only', 'structure_and_data', 'data_only'])
export type CloneCopyIntent = z.infer<typeof cloneCopyIntentSchema>

/** Qué hacer con las filas que YA estén en la tabla destino. Solo aplica con `data_only`. */
export const cloneDataOnExistingSchema = z.enum(['append', 'upsert'])
export type CloneDataOnExisting = z.infer<typeof cloneDataOnExistingSchema>

export const cloneSelectionModeSchema = z.enum(['all', 'include', 'all_except'])
export type CloneSelectionMode = z.infer<typeof cloneSelectionModeSchema>

export const cloneDataSelectionModeSchema = z.enum(['none', 'all', 'include', 'all_except'])
export type CloneDataSelectionMode = z.infer<typeof cloneDataSelectionModeSchema>

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
  /**
   * `false` = el catálogo del motor NO sabe cuántas filas hay (PostgreSQL sin `ANALYZE`,
   * `TABLE_ROWS` en NULL). Sin este campo, `row_estimate: 0` es indistinguible de una tabla
   * vacía y una tabla de millones se muestra como vacía.
   */
  row_estimate_known: z.boolean().nullish(),
  /** Solo tablas. `false` = un `upsert` sobre ella degrada a INSERT simple. */
  has_primary_key: z.boolean().nullish(),
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
  /**
   * La intención EFECTIVA. Se lee esto y no `include_data`: ese booleano legacy no
   * distingue `data_only` de `structure_only`, así que derivar el modo de ahí muestra mal
   * la copia de solo datos. Va `.nullish()` porque un backend anterior no lo manda.
   */
  copy_intent: cloneCopyIntentSchema.nullish(),
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

// ── Selección declarativa (el otro idioma del SPEC) ──────────────────────────────
/**
 * Selección DECLARATIVA de estructura: el backend la resuelve contra el catálogo del origen con
 * la misma función que el export, así que `all_except` y los patrones se comportan igual en los
 * dos módulos.
 *
 * **El orden de resolución importa y tiene un filo:** primero se recorta por `types`, después se
 * aplica `mode` sobre `names`, y recién entonces los patrones FILTRAN lo ya elegido. Con
 * `mode: 'include'` y `names: []` el conjunto base es VACÍO, así que unos `include_patterns` sin
 * `names` no seleccionan nada. Para «los objetos que matcheen X» el modo correcto es `all` con
 * `include_patterns` — que es lo que construye `buildStructureSpec` del asistente.
 */
export const cloneStructureSpecSchema = z.object({
  mode: cloneSelectionModeSchema.optional().default('all'),
  /** Filtro por tipo de objeto; vacío = todos los tipos del catálogo. */
  types: z.array(cloneObjectTypeSchema).optional().default([]),
  /** Nombres exactos. El match es por NOMBRE, sin tipo: usa `types` para desambiguar. */
  names: z.array(z.string()).optional().default([]),
  /** Patrones fnmatch sobre nombres del catálogo (nunca SQL): `fact_*`. */
  include_patterns: z.array(z.string()).optional().default([]),
  /** Patrones a quitar. La exclusión GANA sobre la inclusión. */
  exclude_patterns: z.array(z.string()).optional().default([]),
})
export type CloneStructureSpec = z.infer<typeof cloneStructureSpecSchema>

/** Selección de datos: eje propio, no un booleano colgado de la estructura. Solo salen de TABLAS. */
export const cloneDataSpecSchema = z.object({
  mode: cloneDataSelectionModeSchema.optional().default('none'),
  names: z.array(z.string()).optional().default([]),
  include_patterns: z.array(z.string()).optional().default([]),
  exclude_patterns: z.array(z.string()).optional().default([]),
  /** OBLIGATORIO con `copy_intent: 'data_only'`; no admitido en los otros modos. */
  on_existing: cloneDataOnExistingSchema.nullish(),
})
export type CloneDataSpec = z.infer<typeof cloneDataSpecSchema>

/** Charset/collation de la BD destino. Solo aplica cuando el job CREA la base. */
export const cloneCharsetSpecSchema = z.object({
  mode: z.enum(['keep', 'override']).optional().default('keep'),
  charset: z.string().max(50).nullish(),
  collation: z.string().max(100).nullish(),
})
export type CloneCharsetSpec = z.infer<typeof cloneCharsetSpecSchema>

/**
 * Una fila del historial (`GET /database-clones`). Extiende el resumen con lo que solo tiene
 * sentido en un listado.
 *
 * `batch_id`/`batch_seq` salen de un LEFT JOIN contra `clone_batch_items` del lado del
 * backend, porque la relación vive solo de ese lado: un `CloneJob` no sabe que nació de un
 * lote. Sin ese dato, los N hijos de un lote son N filas indistinguibles de clones sueltos.
 */
export const cloneListItemOutSchema = cloneSummaryOutSchema.extend({
  batch_id: z.number().int().nullish(),
  batch_seq: z.number().int().nullish(),
  /** Calculado en el servidor: es lo que habilita ordenar por duración sobre el conjunto. */
  duration_ms: z.number().int().nullish(),
})
export type CloneListItemOut = z.infer<typeof cloneListItemOutSchema>

// ── Preview ──────────────────────────────────────────────────────────────────────
/**
 * Body de `POST .../preview`. **Todos los campos son opcionales y el backend aplica solo lo que
 * VIENE**: un campo ausente deja el valor que el plan ya tenía, no lo borra.
 *
 * `selection` y `structure` son los dos idiomas para decir lo mismo y son **mutuamente
 * excluyentes**: el backend mira las claves REALMENTE enviadas, así que mandar `selection: null`
 * junto a `structure` ya cuenta como enviar las dos y responde 422. Construye el body con
 * `buildPreviewBody`, que garantiza un solo idioma por llamada.
 */
export const clonePreviewInSchema = z.object({
  selection: z.array(cloneObjectRefSchema).nullable().optional(),
  copy_intent: cloneCopyIntentSchema.nullish(),
  structure: cloneStructureSpecSchema.nullish(),
  data: cloneDataSpecSchema.nullish(),
  target_charset: cloneCharsetSpecSchema.nullish(),
  /** ServerUser del servidor DESTINO que será OWNER de la BD creada. Solo PostgreSQL. */
  target_owner_user_id: z.number().int().min(1).nullish(),
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
  row_estimate_known: z.boolean().nullish(),
  has_primary_key: z.boolean().nullish(),
  upsert: z.boolean(),
})
export type ClonePreviewDataTableOut = z.infer<typeof clonePreviewDataTableOutSchema>

/**
 * Aviso con CÓDIGO estable, para mapearlo a nuestro texto y a nuestro peso visual en vez de
 * matchear prosa con expresiones regulares (que es lo que hace `wizard/messages.ts`).
 *
 * `severity` lleva `.catch()` a propósito: el backend tiene pendiente sumar un nivel `danger`
 * (`T-260822-lz-clon-contrato-frontend`), y sin la red un valor nuevo haría que el `safeParse`
 * del envelope descarte la respuesta ENTERA del preview. Degradar a `warning` es estrictamente
 * mejor que perder el plan.
 */
export const cloneNoticeOutSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning']).catch('warning'),
  detail: z.record(z.string(), z.unknown()).nullish(),
})
export type CloneNoticeOut = z.infer<typeof cloneNoticeOutSchema>

/**
 * Incompatibilidad entre el esquema del origen y el del DESTINO para una tabla que va a recibir
 * filas. `reason` es de vocabulario CERRADO (nunca el mensaje del motor), pero se tipa como
 * `string` por lo mismo que arriba: un motivo nuevo no puede costar la respuesta entera.
 */
export const cloneCompatIssueOutSchema = z.object({
  table: z.string(),
  reason: z.string(),
  blocking: z.boolean(),
  column: z.string().nullish(),
  detail: z.record(z.string(), z.unknown()).nullish(),
})
export type CloneCompatIssueOut = z.infer<typeof cloneCompatIssueOutSchema>

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
  // ── Valores EFECTIVOS ya resueltos por el servidor ─────────────────────────────
  // Se renderiza lo que el servidor decidió en vez de re-derivarlo acá: si el formulario
  // reimplementa las reglas, las dos implementaciones divergen en silencio.
  copy_intent: cloneCopyIntentSchema.nullish(),
  data_on_existing: cloneDataOnExistingSchema.nullish(),
  target_charset: z.string().nullish(),
  target_collation: z.string().nullish(),
  target_owner: z.string().nullish(),
  notices: z.array(cloneNoticeOutSchema).nullish(),
  /**
   * Incompatibilidades que IMPIDEN ejecutar. Si viene con contenido, `confirm_token` llega
   * VACÍO: el plan se puede ver pero no confirmar.
   */
  blocking_issues: z.array(cloneCompatIssueOutSchema).nullish(),
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
