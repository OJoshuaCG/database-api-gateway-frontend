import { z } from 'zod'
import { engineTypeSchema, migrationKindSchema, SLUG_PATTERN } from './common'
import { dumpObjectTypeSchema } from './snapshot'
import { managedDatabaseOutSchema } from './managed-databases'

/** `DatabaseModelOut` (§8). */
export const databaseModelOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  current_version: z.string(),
  is_active: z.boolean(),
  /**
   * Juego de caracteres y collation de REFERENCIA del esquema (api-reference-v11 §2). Un
   * blueprint es el esquema base que sus BDs replican, y el collation forma parte del esquema.
   * Nulables: los blueprints anteriores no lo declaran, y mientras esté vacío el validador no
   * puede marcar conflictos. Semántica de la familia MySQL — no aplica a destinos PostgreSQL.
   */
  charset: z.string().nullable().optional(),
  collation: z.string().nullable().optional(),
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
  charset: z.string().max(50, 'Máximo 50 caracteres').nullable().optional(),
  collation: z.string().max(100, 'Máximo 100 caracteres').nullable().optional(),
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
    name: z.string().max(200).optional(),
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
    database: z.string().min(1, 'Requerido').max(64, 'Máximo 64 caracteres'),
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

/**
 * Una BD del blueprint con su estado de despliegue (api-reference-v11 §3).
 *
 * Extiende el listado que ya existía en vez de ser un recurso nuevo: son tres campos más
 * sobre la misma entidad, y un endpoint hermano habría obligado a cruzar dos respuestas.
 *
 * `model_version` es la copia que el gateway mantiene tras cada apply, no una lectura en
 * vivo del motor. Para forzar la relectura, `?refresh=true` (🔌).
 */
export const modelDatabaseStatusSchema = managedDatabaseOutSchema.extend({
  pending_count: z.number().int().optional().default(0),
  pending_versions: z.array(z.string()).optional().default([]),
  /** Ojo: `model_version` NO lo refleja — Alembic solo registra al TERMINAR el upgrade. */
  has_partial_application: z.boolean().optional().default(false),
})
export type ModelDatabaseStatus = z.infer<typeof modelDatabaseStatusSchema>

// ── Contabilidad de versiones y renombrado del slug (api-reference-v25) ────────
/*
 * Los dos bloques que siguen son las dos caras del mismo incidente: el `slug` nombra la tabla
 * `_gw_v_<slug>` DENTRO de cada base gestionada, así que cambiarlo por un campo de formulario
 * no renombraba nada en los motores y dejaba al gateway leyendo una tabla inexistente.
 * `/version-tables` diagnostica el daño; `rename-slug` es la operación que lo hace bien.
 */

/**
 * Una tabla de versión que el gateway **no lee**, con la versión que guarda dentro (v25 §2).
 *
 * `version` es el dato con el que se decide el `stamp` de recuperación. `null` significa que la
 * tabla existe pero está **VACÍA** — que no es lo mismo que «no se pudo leer», y por eso ahí no
 * hay CTA precargado que ofrecer.
 */
export const orphanVersionTableSchema = z.object({
  /** Nombre real en el motor, p. ej. `_gw_v_test_db`. */
  table: z.string(),
  version: z.string().nullable().optional().default(null),
})
export type OrphanVersionTable = z.infer<typeof orphanVersionTableSchema>

/**
 * Estado de la contabilidad de versiones de UNA base (v25 §3.4). Enum cerrado de cinco.
 *
 * Dos trampas que cuestan caro si se pintan mal:
 * - `none` **NO es un problema**: es el estado normal de una base que nunca fue posicionada.
 *   Pintarlo en ámbar hace que el informe grite en blueprints perfectamente sanos.
 * - `unreachable` **NO es «está bien»**: es indeterminado. No se agrupa con `ok` ni se cuenta
 *   como resuelto, y `needs_attention` no lo cuenta.
 */
export const versionTableStatusSchema = z.enum(['ok', 'orphaned', 'mixed', 'none', 'unreachable'])
export type VersionTableStatus = z.infer<typeof versionTableStatusSchema>

/** Fila del informe: qué contabilidad tiene realmente una base gestionada (v25 §2). */
export const versionTableDatabaseSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  server_name: z.string().nullable().optional().default(null),
  /** La tabla que predice el slug VIGENTE. */
  expected_table: z.string(),
  /** Tablas internas del gateway halladas en esa base. */
  present_tables: z.array(z.string()).optional().default([]),
  orphan_tables: z.array(orphanVersionTableSchema).optional().default([]),
  /** Leída de la tabla ESPERADA; `null` cuando esa tabla no existe. */
  current_version: z.string().nullable().optional().default(null),
  /** Lo que el inventario del gateway registró. El contraste con la real decide el stamp. */
  cached_version: z.string().nullable().optional().default(null),
  status: versionTableStatusSchema,
  /** Texto del backend. Se muestra tal cual y sin resumir. */
  detail: z.string().nullable().optional().default(null),
})
export type VersionTableDatabase = z.infer<typeof versionTableDatabaseSchema>

/**
 * `VersionTablesReportOut` — informe de `GET /database-models/{id}/version-tables` (v25 §3.4).
 *
 * **No pagina**: devuelve todas las bases del blueprint. Un motor caído no rompe el informe —
 * esa base sale `unreachable` dentro de un 200 y el resto se reporta igual.
 */
export const versionTablesReportSchema = z.object({
  model_id: z.number().int(),
  slug: z.string(),
  expected_table: z.string(),
  databases: z.array(versionTableDatabaseSchema).optional().default([]),
  /**
   * Contadores por estado. El backend lo declara `dict[str, int]` **abierto**, así que se
   * renderiza tolerante: puede faltar alguna de las cinco claves y puede traer una desconocida.
   */
  summary: z.record(z.string(), z.number()).optional().default({}),
  /** Semáforo: `true` si hay al menos una base `orphaned` o `mixed`. No cuenta `unreachable`. */
  needs_attention: z.boolean().optional().default(false),
})
export type VersionTablesReport = z.infer<typeof versionTablesReportSchema>

/**
 * Qué le pasa a una base en el plan de renombrado (v25 §3.2). Enum cerrado de cuatro.
 *
 * 🔴 `conflict` y `unreachable` **abortan la operación entera**, no solo esa base: el gateway
 * apunta a UN nombre, así que dejar medio parque renombrado deja a la otra mitad con su
 * contabilidad huérfana — el estado del que cuesta salir.
 */
export const renameSlugActionSchema = z.enum(['rename', 'skip', 'conflict', 'unreachable'])
export type RenameSlugAction = z.infer<typeof renameSlugActionSchema>

/**
 * Una base dentro del plan de renombrado (v25 §2).
 *
 * Misma forma en los **cuatro** sitios donde aparece: `databases[]` y `blockers[]` del plan,
 * `renamed_databases[]` del resultado, y las listas de los `public_context` de error.
 */
export const renameSlugDatabaseSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  server_name: z.string().nullable().optional().default(null),
  action: renameSlugActionSchema,
  detail: z.string().nullable().optional().default(null),
})
export type RenameSlugDatabase = z.infer<typeof renameSlugDatabaseSchema>

/**
 * `RenameSlugPlanOut` — preview de `POST .../rename-slug/plan` (v25 §3.2). **No escribe nada**,
 * pero abre una conexión por base 🔌 y está limitado a 10/min: se pide por clic explícito, nunca
 * al montar el diálogo ni por pulsación de tecla.
 */
export const renameSlugPlanSchema = z.object({
  model_id: z.number().int(),
  current_slug: z.string(),
  new_slug: z.string(),
  current_table: z.string(),
  new_table: z.string(),
  /**
   * `true` = los dos slugs truncan al MISMO nombre de tabla (tope de 63 caracteres). No hay
   * nada que renombrar en ningún motor: el cambio es puramente local, no se emite token y la
   * ejecución **no lo pide**.
   */
  no_op: z.boolean().optional().default(false),
  databases: z.array(renameSlugDatabaseSchema).optional().default([]),
  rename_count: z.number().int().optional().default(0),
  /** Subconjunto de `databases` con `action` `conflict` o `unreachable`. */
  blockers: z.array(renameSlugDatabaseSchema).optional().default([]),
  requires_confirmation: z.boolean().optional().default(false),
  /** Emitido SOLO si hay bases que renombrar y nada bloquea. */
  confirm_token: z.string().nullable().optional().default(null),
  /** ISO 8601 UTC. La UI cuenta atrás contra esto y no manda un token vencido. */
  expires_at: z.string().nullable().optional().default(null),
  /**
   * Huella del parque con la que se ata el token. **No se muestra**: es un detalle de
   * implementación y sugiere que se puede hacer algo con él.
   */
  fingerprint: z.string().optional().default(''),
})
export type RenameSlugPlan = z.infer<typeof renameSlugPlanSchema>

/** `RenameSlugOut` — resultado de `POST .../rename-slug` (v25 §3.3). */
export const renameSlugResultSchema = z.object({
  /** El blueprint con el slug NUEVO. */
  model: databaseModelOutSchema,
  /** Las bases en las que el rename SÍ se ejecutó. */
  renamed_databases: z.array(renameSlugDatabaseSchema).optional().default([]),
  no_op: z.boolean().optional().default(false),
})
export type RenameSlugResult = z.infer<typeof renameSlugResultSchema>

/**
 * Entrada de los dos endpoints de renombrado (v25 §2). Mismo `SLUG_PATTERN` que la creación.
 *
 * `confirm_token` es solo del endpoint de ejecución: obligatorio si el plan tiene bases que
 * renombrar, y **se omite** cuando no hay ninguna. Un token que no hace falta entrena al
 * cliente a mandarlo siempre.
 */
export const renameSlugInSchema = z.object({
  new_slug: z
    .string()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(SLUG_PATTERN, 'kebab/snake en minúsculas (ej. mi-blueprint)'),
  confirm_token: z.string().optional(),
})
export type RenameSlugIn = z.infer<typeof renameSlugInSchema>

/**
 * Códigos estables de `detail.public_context.code` de los blueprints (v25 §6).
 *
 * **Se clasifica por `code`, nunca por la prosa ni por el número de status.** `slugRenamePlanStale`
 * es el caso que lo justifica: el controller lo re-etiqueta heredando el status del servicio de
 * token (típicamente 422, pero no está garantizado), así que ramificar por número lo perdería.
 *
 * Cuatro de los siete traen **datos estructurados** y hay que pintarlos, no quedarse en el `msg`:
 *
 * - `slugInUse` trae `current_slug`, `requested_slug` y `managed_database_count`: es el 409 del
 *   `PATCH`, y su CTA es el asistente de renombrado, no reintentar.
 * - `slugRenameConflict` trae `new_table` y `conflicting_databases[]`; `slugRenameUnreachable`
 *   trae `unreachable_databases[]`. El segundo es **fail-closed**: no significa «esa base no
 *   tiene la tabla destino», significa «no se pudo probar que no la tenga».
 * - `slugRenameConfirmationRequired` trae `rename_plan[]`: falta el `confirm_token`. No debería
 *   ser alcanzable desde la UI; su salida es volver al preview.
 * - `slugRenameFailed` es el único que **no es un error normal**: trae `failed` (la base en la
 *   que falló), `renamed[]` (las que se devolvieron a su nombre original) y `not_compensated[]`
 *   (🔴 las que quedaron con el nombre NUEVO y hay que reparar a mano). El slug del blueprint
 *   NO se modificó. Es una pantalla de incidente, sin botón de reintentar.
 */
export const DATABASE_MODEL_ERROR_CODES = {
  slugInUse: 'database_model.slug_in_use',
  nameOrSlugTaken: 'database_model.name_or_slug_taken',
  slugRenameConflict: 'database_model.slug_rename_conflict',
  slugRenameUnreachable: 'database_model.slug_rename_unreachable',
  slugRenameConfirmationRequired: 'database_model.slug_rename_confirmation_required',
  slugRenamePlanStale: 'database_model.slug_rename_plan_stale',
  slugRenameFailed: 'database_model.slug_rename_failed',
} as const
