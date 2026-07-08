import { z } from 'zod'
import { engineTypeSchema, migrationKindSchema, SLUG_PATTERN } from './common'
import { dumpObjectTypeSchema } from './snapshot'

/** `DatabaseModelOut` (§8). */
export const databaseModelOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  current_version: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type DatabaseModelOut = z.infer<typeof databaseModelOutSchema>

/** `DatabaseModelCreate` (§8). */
export const databaseModelCreateSchema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  slug: z
    .string()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(SLUG_PATTERN, 'kebab/snake en minúsculas (ej. mi-blueprint)'),
  description: z.string().nullable().optional(),
  current_version: z.string().max(50, 'Máximo 50 caracteres').optional(),
  is_active: z.boolean().optional(),
})
export type DatabaseModelCreate = z.infer<typeof databaseModelCreateSchema>

/** `DatabaseModelUpdate` — mismos campos, todos opcionales. */
export const databaseModelUpdateSchema = databaseModelCreateSchema.partial()
export type DatabaseModelUpdate = z.infer<typeof databaseModelUpdateSchema>

// ── Snapshot selectivo (Plan 09 §6) ─────────────────────────────────────────────

/** Estrategia de versionado del snapshot. `single` reproduce el comportamiento histórico. */
export const snapshotLayoutSchema = z.enum(['single', 'by_class', 'manual'])
export type SnapshotLayout = z.infer<typeof snapshotLayoutSchema>

/** Modo de siembra de datos por tabla. La sintaxis difiere por motor (atado a `source_engine`). */
export const dataSeedModeSchema = z.enum(['upsert', 'insert_ignore'])
export type DataSeedMode = z.infer<typeof dataSeedModeSchema>

/** Qué hacer si una tabla de datos supera el guardrail de tamaño. */
export const onOversizeSchema = z.enum(['skip', 'error'])
export type OnOversize = z.infer<typeof onOversizeSchema>

/** Máximo de tablas de datos por snapshot (guardrail por defecto del backend). */
export const MAX_DATA_TABLES = 25

/** Referencia a un objeto concreto del snapshot (para include/exclude y buckets manuales). */
export const snapshotObjectRefSchema = z.object({
  object_type: dumpObjectTypeSchema,
  name: z.string().min(1),
})
export type SnapshotObjectRef = z.infer<typeof snapshotObjectRefSchema>

/** Selección de una tabla de datos-semilla + su modo de siembra. */
export const dataTableSelSchema = z.object({
  table: z.string().min(1),
  mode: dataSeedModeSchema,
})
export type DataTableSel = z.infer<typeof dataTableSelSchema>

/**
 * `ManualBucket` — una versión del layout manual. Es de esquema (`objects`) **o** de datos
 * (`data_tables`), nunca ambos ni vacío. El orden en la lista fija el número de versión.
 */
export const manualBucketSchema = z
  .object({
    name: z.string().optional(),
    objects: z.array(snapshotObjectRefSchema).optional(),
    data_tables: z.array(z.string()).optional(),
  })
  .refine(
    (bucket) => {
      const hasObjects = (bucket.objects?.length ?? 0) > 0
      const hasData = (bucket.data_tables?.length ?? 0) > 0
      return hasObjects !== hasData // XOR: exactamente uno, no vacío
    },
    {
      message:
        'Cada versión debe contener objetos de esquema O tablas de datos (no ambos, ni vacía).',
    },
  )
export type ManualBucket = z.infer<typeof manualBucketSchema>

/**
 * `FromSnapshotIn` (Plan 09 §6) — crea un blueprint versionado desde el snapshot de una BD.
 * Retrocompatible: con solo `server_id`/`database`/`name`/`slug` reproduce la captura histórica
 * (`layout="single"`, sin datos). Todas las versiones nacen `reviewed=false`.
 */
export const fromSnapshotInSchema = z
  .object({
    server_id: z.number().int().min(1),
    database: z.string().min(1, 'Requerido'),
    name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
    slug: z
      .string()
      .min(1, 'Requerido')
      .max(120, 'Máximo 120 caracteres')
      .regex(SLUG_PATTERN, 'kebab/snake en minúsculas (ej. crm-legacy)'),
    description: z.string().nullable().optional(),
    baseline_name: z.string().min(1).max(200).nullable().optional(),
    layout: snapshotLayoutSchema.optional(),
    include_object_types: z.array(dumpObjectTypeSchema).optional(),
    exclude_object_types: z.array(dumpObjectTypeSchema).optional(),
    include_objects: z.array(snapshotObjectRefSchema).optional(),
    exclude_objects: z.array(snapshotObjectRefSchema).optional(),
    data_tables: z.array(dataTableSelSchema).max(MAX_DATA_TABLES).optional(),
    on_oversize: onOversizeSchema.optional(),
    confirm_data_rollback: z.boolean().optional(),
    manual_layout: z.array(manualBucketSchema).optional(),
  })
  .superRefine((value, ctx) => {
    // `manual_layout` es REQUERIDO con layout="manual" y PROHIBIDO en otro caso.
    const hasManual = (value.manual_layout?.length ?? 0) > 0
    if (value.layout === 'manual' && !hasManual) {
      ctx.addIssue({
        code: 'custom',
        path: ['manual_layout'],
        message: 'Requerido cuando el layout es manual.',
      })
    }
    if (value.layout !== 'manual' && hasManual) {
      ctx.addIssue({
        code: 'custom',
        path: ['manual_layout'],
        message: 'Solo se permite con layout manual.',
      })
    }
  })
export type FromSnapshotIn = z.infer<typeof fromSnapshotInSchema>

/**
 * `SkippedTable` (Plan 09 §6) — tabla de datos que se omitió y por qué. `reason` es un enum del
 * backend salvo `unsupported_type:<tipo>`, que lleva sufijo dinámico → se modela como string.
 */
export const skippedTableSchema = z.object({
  table: z.string(),
  reason: z.string(),
})
export type SkippedTable = z.infer<typeof skippedTableSchema>

/** `VersionSummary` (Plan 09 §6) — resumen de una versión creada por el snapshot. */
export const versionSummarySchema = z.object({
  version: z.string(),
  kind: migrationKindSchema,
  name: z.string(),
  object_counts: z.record(z.string(), z.number()).default({}),
  has_non_portable: z.boolean(),
})
export type VersionSummary = z.infer<typeof versionSummarySchema>

/**
 * `FromSnapshotOut` (Plan 09 §6) — blueprint creado + resumen. NUNCA incluye el SQL generado ni
 * valores de filas (el SQL de cada versión se revisa en la UI de migraciones de Plan 02).
 */
export const fromSnapshotOutSchema = z.object({
  model: databaseModelOutSchema,
  baseline_version: z.string(),
  source_engine: engineTypeSchema,
  has_non_portable: z.boolean(),
  object_counts: z.record(z.string(), z.number()).default({}),
  statements_captured: z.number().int(),
  total_versions: z.number().int().optional(),
  data_tables_captured: z.number().int().optional(),
  skipped_tables: z.array(skippedTableSchema).default([]),
  versions: z.array(versionSummarySchema).default([]),
})
export type FromSnapshotOut = z.infer<typeof fromSnapshotOutSchema>
