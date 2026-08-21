import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  applyAllResultSchema,
  migrationValidateOutSchema,
  modelMigrationOutSchema,
  modelMigrationSummarySchema,
  type ApplyAllResult,
  type MigrationValidateIn,
  type MigrationValidateOut,
  type ModelMigrationCreate,
  type ModelMigrationOut,
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
  force?: boolean
  dryRun?: boolean
  /** Manejo del fallo a mitad de una migración multi-sentencia (§9; solo MySQL/MariaDB). */
  onFailure?: OnFailureMode
  /**
   * Consentimiento explícito de captura de SELECT (api-reference-v9 §3.7). Se evalúa POR BD, no
   * una vez para todo el lote: el `409` de una BD no frena el resto del lote.
   */
  allowResultCapture?: boolean
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
      force: options.force,
      dry_run: options.dryRun,
      on_failure: options.onFailure,
      allow_result_capture: options.allowResultCapture,
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
