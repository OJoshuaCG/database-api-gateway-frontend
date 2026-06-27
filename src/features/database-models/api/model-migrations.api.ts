import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  applyAllResultSchema,
  modelMigrationOutSchema,
  modelMigrationSummarySchema,
  type ApplyAllResult,
  type ModelMigrationCreate,
  type ModelMigrationOut,
  type ModelMigrationPatch,
  type ModelMigrationSummary,
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
  return mutateData('PATCH', `${base(modelId)}/${encodeURIComponent(version)}`, modelMigrationOutSchema, {
    body,
  })
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
  force?: boolean
  dryRun?: boolean
}

/** `POST .../migrations/apply-all` 🔌 — aplica a todas las BDs del blueprint (rate limit 3/min). */
export function applyAllMigrations(
  modelId: number,
  options: ApplyAllOptions = {},
): Promise<ApplyAllResult> {
  return mutateData('POST', `${base(modelId)}/apply-all`, applyAllResultSchema, {
    query: {
      max_databases: options.maxDatabases,
      force: options.force,
      dry_run: options.dryRun,
    },
  })
}
