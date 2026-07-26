import { z } from 'zod'
import { engineTypeSchema } from './common'
import { modelMigrationOutSchema } from './model-migrations'
import { migrationApplyOutSchema } from './db-migrations'

/**
 * Comparación de esquemas entre dos BDs gestionadas del mismo motor (feature
 * `schema-comparisons`): diff estructural de solo lectura + dos acciones derivadas mutuamente
 * excluyentes según si el target tiene blueprint (`model_id`): adoptar como versión del
 * blueprint (§ adopt) o ejecutar el diff directo sobre el target (§ execute). El primer paso
 * (crear/leer la comparación y sus ítems) es siempre de solo lectura sobre ambos motores.
 */

// ── Enums ──────────────────────────────────────────────────────────────────────
export const schemaObjectTypeSchema = z.enum([
  'table',
  'column',
  'primary_key',
  'foreign_key',
  'unique_constraint',
  'check_constraint',
  'index',
  'view',
  'materialized_view',
  'routine',
  'trigger',
  'event',
  'sequence',
  'enum_type',
  'extension',
])
export type SchemaObjectType = z.infer<typeof schemaObjectTypeSchema>

export const schemaChangeTypeSchema = z.enum(['new', 'modified', 'dropped'])
export type SchemaChangeType = z.infer<typeof schemaChangeTypeSchema>

export const schemaComparisonExecutionStatusSchema = z.enum(['applied', 'failed', 'skipped'])
export type SchemaComparisonExecutionStatus = z.infer<typeof schemaComparisonExecutionStatusSchema>

export const executeModeSchema = z.enum(['all', 'all_except_destructive', 'custom'])
export type ExecuteMode = z.infer<typeof executeModeSchema>

// ── Banderas de riesgo (embebidas en cada ítem) ─────────────────────────────────
/**
 * `possible_rename_of` es una heurística advisory: si no es `null`, el `DROP`/`CREATE` al que
 * está adjunta probablemente sea en realidad un RENAME del objeto nombrado (v1 no detecta
 * renames automáticamente; los expone como DROP+CREATE). `requires_individual_review` marca
 * objetos procedurales que NUNCA entran en los modos automáticos de ejecución.
 */
export const riskFlagsSchema = z.object({
  destructive: z.boolean(),
  lock_heavy: z.boolean(),
  data_conversion: z.boolean(),
  needs_review: z.boolean(),
  requires_individual_review: z.boolean(),
  cross_flavor_warning: z.boolean(),
  possible_rename_of: z.string().nullable(),
})
export type RiskFlags = z.infer<typeof riskFlagsSchema>

// ── Conteos por tipo de objeto (resumen) ────────────────────────────────────────
/**
 * Mapa `object_type` (string) → conteos por `change_type`. Cuenta OBJETOS, no sentencias: un
 * mismo objeto lógico puede rendir varias sentencias (`item_count` del resumen sí cuenta
 * sentencias). Mismo patrón que `object_counts` en `snapshot.ts` (`z.record(z.string(), ...)`,
 * no una clave-enum).
 */
export const schemaComparisonCountsSchema = z.record(
  z.string(),
  z.object({
    new: z.number().int().optional(),
    modified: z.number().int().optional(),
    dropped: z.number().int().optional(),
  }),
)
export type SchemaComparisonCounts = z.infer<typeof schemaComparisonCountsSchema>

// ── Resumen de la comparación ───────────────────────────────────────────────────
/**
 * `source_database_id`/`target_database_id` son `null` cuando ese lado es una BD "cruda" (viva
 * en el motor pero fuera del inventario del gateway) — o un número si está en el inventario
 * (mandada por id directo, o auto-resuelta desde una referencia cruda que coincidía con una BD
 * ya adoptada). `*_server_id`/`*_database_name` identifican la BD FÍSICA de cada lado y SIEMPRE
 * vienen poblados, sea cual sea la forma en que se mandó ese lado — son los únicos campos
 * garantizados para etiquetar los lados en toda la UI (encabezados, `confirm_target_name`,
 * resultado). Estos campos `null` se serializan literalmente (el modelo Pydantic de `data` no
 * excluye sus propios `None`; solo el envelope `ApiResponse` de nivel superior lo hace) — hay
 * que comparar el VALOR contra `null`, nunca comprobar si la clave existe.
 */
export const schemaComparisonSummaryOutSchema = z.object({
  id: z.number().int(),
  source_server_id: z.number().int(),
  source_database_name: z.string(),
  target_server_id: z.number().int(),
  target_database_name: z.string(),
  source_database_id: z.number().int().nullable(),
  target_database_id: z.number().int().nullable(),
  source_engine: engineTypeSchema,
  target_engine: engineTypeSchema,
  cross_flavor_warning: z.boolean(),
  scope_note: z.string().nullable().optional(),
  item_count: z.number().int(),
  counts: schemaComparisonCountsSchema,
  has_destructive: z.boolean(),
  expired: z.boolean(),
  created_at: z.string(),
  expires_at: z.string(),
})
export type SchemaComparisonSummaryOut = z.infer<typeof schemaComparisonSummaryOutSchema>

/**
 * Body de `POST /schema-comparisons`. Cada lado (`source`/`target`) se especifica con
 * EXACTAMENTE una de dos representaciones: `{lado}_database_id` (BD del inventario) o
 * `{lado}_server_id` + `{lado}_database_name` (referencia cruda: cualquier BD viva del motor
 * de ese servidor, esté o no adoptada — el backend la auto-resuelve si coincide con una
 * adoptada). Nunca ambas ni ninguna para un mismo lado (`422` si se viola). La dirección
 * (`source` = referencia/estado deseado, `target` = la que se modifica) sigue siendo explícita.
 */
export const createSchemaComparisonInSchema = z.object({
  source_database_id: z.number().int().optional(),
  source_server_id: z.number().int().optional(),
  source_database_name: z.string().optional(),
  target_database_id: z.number().int().optional(),
  target_server_id: z.number().int().optional(),
  target_database_name: z.string().optional(),
})
export type CreateSchemaComparisonIn = z.infer<typeof createSchemaComparisonInSchema>

// ── Ítems del diff (detalle paginado) ───────────────────────────────────────────
/**
 * `op_group` (§10.3): grupo ATÓMICO del cambio. Un objeto redefinido (mismo nombre, definición
 * distinta) rinde DOS filas (DROP del viejo + CREATE del nuevo) que comparten `op_group` y deben
 * seleccionarse/deseleccionarse JUNTAS (enviar media selección da 422). `null` = ítem suelto sin
 * grupo (comparaciones creadas antes de este campo): se trata como individual. `depends_on` lista
 * los `op_group` que deben ejecutarse ANTES (solo dependencias que se crean en esta misma
 * comparación) — advisory en la UI; el cierre real lo hace `POST .../resolve-selection`.
 */
export const schemaComparisonItemOutSchema = z.object({
  id: z.number().int(),
  comparison_id: z.number().int(),
  seq: z.number().int(),
  object_type: schemaObjectTypeSchema,
  object_name: z.string(),
  change_type: schemaChangeTypeSchema,
  phase: z.number().int(),
  sql: z.string(),
  risk_flags: riskFlagsSchema,
  op_group: z.string().nullable(),
  depends_on: z.array(z.string()),
  down_sql: z.string().nullable(),
  down_confirmed: z.boolean(),
  execution_status: schemaComparisonExecutionStatusSchema.nullable(),
  execution_error: z.string().nullable(),
  executed_at: z.string().nullable(),
})
export type SchemaComparisonItemOut = z.infer<typeof schemaComparisonItemOutSchema>

// ── Avisos de plan (§10.6, en adopt / execute-preview / execute) ────────────────
/**
 * Avisos NO bloqueantes sobre el conjunto de sentencias resuelto. Codes conocidos:
 * `create_and_drop_same_object` (casi siempre un rename no detectado) y
 * `destructive_without_rollback` (la versión no podrá revertirse automáticamente). `code` se
 * modela como string abierto: un code nuevo del backend nunca debe romper el contrato.
 */
export const planWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  op_group: z.string().nullable().optional(),
})
export type PlanWarning = z.infer<typeof planWarningSchema>

// ── Cierre de dependencias (§10.6, `POST .../resolve-selection`) ─────────────────
/**
 * `POST /schema-comparisons/{id}/resolve-selection` — SOLO LECTURA: no adopta ni ejecuta nada.
 * Cierra las dependencias de una selección propuesta. ⚠ NO valida expiración (a diferencia de
 * adopt/execute): nunca usarlo como sustituto de refrescar la comparación.
 */
export const resolveComparisonSelectionInSchema = z.object({
  selected_item_ids: z.array(z.number().int()).min(1, 'Selecciona al menos un ítem'),
})
export type ResolveComparisonSelectionIn = z.infer<typeof resolveComparisonSelectionInSchema>

/** Detalle de cada ítem AGREGADO por el cierre (para mostrarlo antes de confirmar). */
export const resolvedSelectionAddedItemSchema = z.object({
  item_id: z.number().int(),
  object_type: schemaObjectTypeSchema,
  object_name: z.string(),
  change_type: schemaChangeTypeSchema,
  sql: z.string(),
})
export type ResolvedSelectionAddedItem = z.infer<typeof resolvedSelectionAddedItemSchema>

/**
 * `data` de `POST .../resolve-selection`. `resolved_item_ids` viene EN ORDEN DE EJECUCIÓN y es
 * la selección final que debe mandarse a adopt/execute. `added_reasons` mapea cada `op_group`
 * agregado → los `op_group` que lo requieren.
 */
export const resolveComparisonSelectionOutSchema = z.object({
  comparison_id: z.number().int(),
  requested_item_ids: z.array(z.number().int()),
  resolved_item_ids: z.array(z.number().int()),
  added_item_ids: z.array(z.number().int()),
  added_reasons: z.record(z.string(), z.array(z.string())),
  added: z.array(resolvedSelectionAddedItemSchema),
  total: z.number().int(),
})
export type ResolveComparisonSelectionOut = z.infer<typeof resolveComparisonSelectionOutSchema>

// ── Opción A: adoptar el diff como versión del blueprint ────────────────────────
/**
 * `auto_resolve_dependencies` (default `false`, fail-closed): si la selección no cierra sus
 * dependencias, el backend responde 422 en vez de completarla solo. Este asistente NUNCA lo
 * activa: el cierre se hace explícito y visible vía `resolve-selection` antes de confirmar.
 */
export const adoptComparisonInSchema = z.object({
  selected_item_ids: z.array(z.number().int()).min(1, 'Selecciona al menos un ítem'),
  name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
  description: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
  execute_immediately: z.boolean().optional().default(false),
  auto_resolve_dependencies: z.boolean().optional(),
})
export type AdoptComparisonIn = z.infer<typeof adoptComparisonInSchema>

/** `added_item_ids`: ítems que el backend sumó a la versión por cierre de dependencias. */
export const adoptComparisonOutSchema = z.object({
  comparison_id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  statements: z.number().int(),
  executed: z.boolean(),
  added_item_ids: z.array(z.number().int()),
  plan_warnings: z.array(planWarningSchema),
  migration: modelMigrationOutSchema,
  apply_result: migrationApplyOutSchema.nullable(),
})
export type AdoptComparisonOut = z.infer<typeof adoptComparisonOutSchema>

// ── Opción B: vista previa + ejecución directa sobre el target ─────────────────
export const executePreviewInSchema = z.object({
  mode: executeModeSchema,
  selected_item_ids: z.array(z.number().int()).nullable().optional(),
})
export type ExecutePreviewIn = z.infer<typeof executePreviewInSchema>

export const executePreviewStatementSchema = z.object({
  item_id: z.number().int(),
  object_type: schemaObjectTypeSchema,
  object_name: z.string(),
  sql: z.string(),
  risk_flags: riskFlagsSchema.partial(),
})
export type ExecutePreviewStatement = z.infer<typeof executePreviewStatementSchema>

/**
 * `data` de `POST .../execute-preview`. `confirm_token` se reenvía TAL CUAL (sin recomputarlo
 * en cliente) en `POST .../execute`: es un SHA256 calculado por el servidor sobre el conjunto
 * exacto de sentencias resueltas, la única fuente de verdad soportada. `target_database_id` es
 * `null` cuando el target es una BD cruda sin adoptar (mismo significado que en
 * `schemaComparisonSummaryOutSchema`). `excluded_by_dependency` (§10.6): en los modos
 * automáticos, si el filtro de riesgo excluye una dependencia, el backend PODA transitivamente a
 * sus dependientes huérfanos — estos `op_group` quedaron FUERA del conjunto y hay que mostrarlos
 * antes de confirmar, porque cambian lo que realmente se ejecuta.
 */
export const executePreviewOutSchema = z.object({
  comparison_id: z.number().int(),
  target_database_id: z.number().int().nullable(),
  mode: z.string(),
  statements: z.array(executePreviewStatementSchema),
  plan_warnings: z.array(planWarningSchema),
  excluded_by_dependency: z.array(z.string()),
  confirm_token: z.string(),
})
export type ExecutePreviewOut = z.infer<typeof executePreviewOutSchema>

/**
 * Body de `POST .../execute`. `confirm_target_name` debe coincidir EXACTO con el nombre real
 * de la BD target (doble confirmación, patrón `confirm_name` del resto de la API); `confirm_token`
 * es el recibido de `execute-preview`, sin modificar.
 */
export const executeComparisonInSchema = z.object({
  mode: executeModeSchema,
  selected_item_ids: z.array(z.number().int()).nullable().optional(),
  confirm_target_name: z.string().min(1, 'Requerido'),
  confirm_token: z.string().min(1, 'Requerido'),
})
export type ExecuteComparisonIn = z.infer<typeof executeComparisonInSchema>

export const schemaComparisonStatementResultSchema = z.object({
  item_id: z.number().int(),
  object_type: schemaObjectTypeSchema,
  object_name: z.string(),
  status: schemaComparisonExecutionStatusSchema,
  error: z.string().nullable(),
  execution_ms: z.number(),
})
export type SchemaComparisonStatementResult = z.infer<typeof schemaComparisonStatementResultSchema>

export const executeComparisonOutSchema = z.object({
  comparison_id: z.number().int(),
  target_database_id: z.number().int().nullable(),
  mode: z.string(),
  total: z.number().int(),
  applied_count: z.number().int(),
  failed: z.boolean(),
  plan_warnings: z.array(planWarningSchema),
  excluded_by_dependency: z.array(z.string()),
  statements: z.array(schemaComparisonStatementResultSchema),
})
export type ExecuteComparisonOut = z.infer<typeof executeComparisonOutSchema>
