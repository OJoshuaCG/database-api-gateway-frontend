import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  migrationApplyResultSchema,
  migrationHistoryItemSchema,
  migrationRollbackResultSchema,
  migrationStampResultSchema,
  migrationStatusOutSchema,
  type MigrationApplyResult,
  type MigrationHistoryItem,
  type MigrationRollbackResult,
  type MigrationStampResult,
  type MigrationStatusOut,
  type Page,
} from '@/lib/contracts'

const base = (dbId: number) => `/managed-databases/${dbId}/migrations`

/** `GET .../migrations/status` 🔌 — versión actual vs. pendientes (§9). */
export function getMigrationStatus(
  dbId: number,
  signal?: AbortSignal,
): Promise<MigrationStatusOut> {
  return fetchData(`${base(dbId)}/status`, migrationStatusOutSchema, { signal })
}

export interface ApplyOptions {
  version?: string
  force?: boolean
  dryRun?: boolean
}

/** `POST .../migrations/apply` 🔌 — aplica las pendientes (o hasta `version`); dry-run opcional (§9). */
export function applyMigrations(
  dbId: number,
  options: ApplyOptions = {},
): Promise<MigrationApplyResult> {
  return mutateData('POST', `${base(dbId)}/apply`, migrationApplyResultSchema, {
    query: { version: options.version, force: options.force, dry_run: options.dryRun },
  })
}

/** `POST .../migrations/rollback` 🔌 — revierte la última aplicada (doble confirmación) (§9). */
export function rollbackMigration(
  dbId: number,
  confirmVersion: string,
): Promise<MigrationRollbackResult> {
  return mutateData('POST', `${base(dbId)}/rollback`, migrationRollbackResultSchema, {
    query: { confirm_version: confirmVersion },
  })
}

/** `POST .../migrations/stamp` 🔌 — marca una versión sin ejecutar SQL (§9). */
export function stampMigration(dbId: number, version: string): Promise<MigrationStampResult> {
  return mutateData('POST', `${base(dbId)}/stamp`, migrationStampResultSchema, {
    query: { version },
  })
}

/** `GET .../migrations/history` 🔌 — historial paginado de aplicaciones (§9). */
export function listMigrationHistory(
  dbId: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<MigrationHistoryItem>> {
  return fetchPage(`${base(dbId)}/history`, migrationHistoryItemSchema, { query: params, signal })
}
