import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  applyAllResultSchema,
  migrationEditPreviewOutSchema,
  migrationValidateOutSchema,
  modelMigrationOutSchema,
  modelMigrationSummarySchema,
  type ApplyAllResult,
  type MigrationValidateIn,
  type MigrationValidateOut,
  type ModelMigrationCreate,
  type ModelMigrationOut,
  type MigrationEditPreviewIn,
  type MigrationEditPreviewOut,
  type ModelMigrationPatch,
  type ModelMigrationSummary,
  type OnFailureMode,
  type Page,
} from '@/lib/contracts'

const base = (modelId: number) => `/database-models/${modelId}/migrations`

/** `GET .../migrations` — lista paginada de resúmenes (§8). */
export function listModelMigrations(
  modelId: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ModelMigrationSummary>> {
  return fetchPage(base(modelId), modelMigrationSummarySchema, { query: params, signal })
}

/** `GET .../migrations/{version}` — detalle completo (§8). */
export function getModelMigration(
  modelId: number,
  version: string,
  signal?: AbortSignal,
): Promise<ModelMigrationOut> {
  return fetchData(`${base(modelId)}/${encodeURIComponent(version)}`, modelMigrationOutSchema, {
    signal,
  })
}

/** `POST .../migrations` — crea una migración; devuelve `translated` + `down_sql_suggested` (§8). */
export function createModelMigration(
  modelId: number,
  body: ModelMigrationCreate,
): Promise<ModelMigrationOut> {
  return mutateData('POST', base(modelId), modelMigrationOutSchema, { body })
}

/** `PATCH .../migrations/{version}` — confirma `down_sql` / añade overrides (§8). */
export function updateModelMigration(
  modelId: number,
  version: string,
  body: ModelMigrationPatch,
): Promise<ModelMigrationOut> {
  return mutateData(
    'PATCH',
    `${base(modelId)}/${encodeURIComponent(version)}`,
    modelMigrationOutSchema,
    {
      body,
    },
  )
}

/** `DELETE .../migrations/{version}` — solo si no tiene historial de aplicación (§8). */
export function deleteModelMigration(
  modelId: number,
  version: string,
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${base(modelId)}/${encodeURIComponent(version)}`)
}

export interface ApplyAllOptions {
  maxDatabases?: number
  /**
   * Destinos concretos. Sin él se aplica a TODAS las BDs del blueprint (hasta `maxDatabases`).
   * Un id que no pertenezca al blueprint devuelve 422 con la lista: es la frontera que impide
   * aplicar sus migraciones a una BD ajena.
   */
  databaseIds?: number[]
  /**
   * Acota el lote a un entorno. Es lo que convierte "aplicá a todo" en "aplicá a desarrollo": el
   * backend lo filtra ANTES del tope, así que `maxDatabases` no se consume con BDs de otros
   * entornos. Combinado con `databaseIds`, un id fuera del entorno devuelve 422 con la lista en
   * vez de desaparecer del lote en silencio.
   */
  environmentId?: number
  force?: boolean
  dryRun?: boolean
  /** Manejo del fallo a mitad de una migración multi-sentencia (§9; solo MySQL/MariaDB). */
  onFailure?: OnFailureMode
}

/** `POST .../migrations/apply-all` 🔌 — aplica a todas las BDs del blueprint (rate limit 3/min). */
export function applyAllMigrations(
  modelId: number,
  options: ApplyAllOptions = {},
): Promise<ApplyAllResult> {
  return mutateData('POST', `${base(modelId)}/apply-all`, applyAllResultSchema, {
    query: {
      max_databases: options.maxDatabases,
      database_ids: options.databaseIds,
      environment_id: options.environmentId,
      force: options.force,
      dry_run: options.dryRun,
      on_failure: options.onFailure,
    },
  })
}

/**
 * `POST .../migrations/validate` — analiza el SQL ANTES de aplicarlo (api-reference-v11 §1).
 *
 * Sin `managed_database_id` es análisis estático y no toca ningún motor. Con él se comprueba
 * además contra el catálogo de esa BD que las tablas referenciadas existan — es lo único que
 * detecta un `ALTER TABLE` sobre una tabla inexistente, que es sintácticamente válido.
 */
export function validateModelMigration(
  modelId: number,
  body: MigrationValidateIn,
  signal?: AbortSignal,
): Promise<MigrationValidateOut> {
  return mutateData('POST', `${base(modelId)}/validate`, migrationValidateOutSchema, {
    body,
    signal,
  })
}

/**
 * `POST .../migrations/{version}/edit-preview` 🔌 (api-reference-v15 §3) — paso 1 de la vía de
 * excepción para editar una versión **ya aplicada**.
 *
 * Lee la versión de cada BD **del motor en vivo**, no de la caché del inventario: por eso abre
 * conexiones y por eso tiene rate limit (20/min). Devuelve a quién va a dejar divergente y, si
 * hace falta confirmar, el `confirm_token` que autoriza el PATCH.
 *
 * ⚠️ El cuerpo tiene que ser **exactamente el mismo** que después va al PATCH: el checksum
 * resultante se calcula por presencia de clave, así que una clave de más o de menos invalida el
 * token. Un 502/504 aquí no es «una BD ilegible» —eso viaja como `reason: "unreadable"` dentro de
 * `blocking_databases`— sino un fallo de la llamada entera: sin token, el flujo no puede seguir.
 */
export function previewModelMigrationEdit(
  modelId: number,
  version: string,
  body: MigrationEditPreviewIn,
): Promise<MigrationEditPreviewOut> {
  return mutateData(
    'POST',
    `${base(modelId)}/${encodeURIComponent(version)}/edit-preview`,
    migrationEditPreviewOutSchema,
    { body },
  )
}
