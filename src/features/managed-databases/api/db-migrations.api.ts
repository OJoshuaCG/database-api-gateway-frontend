import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  migrationApplyResultSchema,
  migrationHistoryItemSchema,
  migrationRollbackResultSchema,
  migrationStampResultSchema,
  migrationStatusOutSchema,
  reconcilePartialResultSchema,
  type MigrationApplyResult,
  type MigrationHistoryItem,
  type MigrationRollbackResult,
  type MigrationStampResult,
  type MigrationStatusOut,
  type OnFailureMode,
  type Page,
  type ReconcilePartialResult,
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
  /** Manejo del fallo a mitad de una migración multi-sentencia (solo MySQL/MariaDB). Default: `auto`. */
  onFailure?: OnFailureMode
  /**
   * Consentimiento explícito por corrida para capturar resultados de SELECT (api-reference-v9
   * §2/§3.2). Default `false`; sin él, si hay versiones con `capture_selects` en el camino, el
   * backend responde `409` con `public_context.capture_versions`.
   */
  allowResultCapture?: boolean
}

/** `POST .../migrations/apply` 🔌 — aplica las pendientes (o hasta `version`); dry-run opcional (§9). */
export function applyMigrations(
  dbId: number,
  options: ApplyOptions = {},
): Promise<MigrationApplyResult> {
  return mutateData('POST', `${base(dbId)}/apply`, migrationApplyResultSchema, {
    query: {
      version: options.version,
      force: options.force,
      dry_run: options.dryRun,
      on_failure: options.onFailure,
      allow_result_capture: options.allowResultCapture,
    },
  })
}

export interface RollbackOptions {
  /** Versión ACTUAL (doble confirmación de operación destructiva). */
  confirmVersion: string
  /** Destino: revierte secuencialmente hasta esta versión. Omitir = solo la última. */
  targetVersion?: string
  /** Igual que en `apply`, pero evaluado sobre el camino de REVERSIÓN (api-reference-v9 §3.3). */
  allowResultCapture?: boolean
}

/**
 * `POST .../migrations/rollback` 🔌 — revierte secuencialmente hasta `target_version` en una sola
 * llamada (Plan 09 §7-bis). Si se omite `target_version`, revierte solo la última aplicada.
 */
export function rollbackMigration(
  dbId: number,
  options: RollbackOptions,
): Promise<MigrationRollbackResult> {
  return mutateData('POST', `${base(dbId)}/rollback`, migrationRollbackResultSchema, {
    query: {
      confirm_version: options.confirmVersion,
      target_version: options.targetVersion,
      allow_result_capture: options.allowResultCapture,
    },
  })
}

export interface StampOptions {
  version: string
  /**
   * Marca la versión aunque el estado registrado no coincida. ⚠️ NO arregla un apply fallido a
   * mitad (afirmaría que la migración corrió completa); solo para "ya reconcilié a mano".
   */
  force?: boolean
}

/** `POST .../migrations/stamp` 🔌 — marca una versión sin ejecutar SQL (§9). Rate limit 10/min. */
export function stampMigration(dbId: number, options: StampOptions): Promise<MigrationStampResult> {
  return mutateData('POST', `${base(dbId)}/stamp`, migrationStampResultSchema, {
    query: { version: options.version, force: options.force },
  })
}

export interface ReconcilePartialOptions {
  /** Versión de `partial_application[]` a deshacer (doble confirmación, obligatoria). */
  confirmVersion: string
  dryRun?: boolean
  /** Permite continuar aunque haya sentencias sin reverso (quedarán aplicadas). */
  force?: boolean
}

/**
 * `POST .../migrations/reconcile-partial` 🔌 — deshace las sentencias aplicadas de una migración
 * que falló a mitad (§9). Rate limit 10/min. ⚠️ El backend valida `force` ANTES de `dry_run`: con
 * sentencias sin reverso y sin `force=true` responde 409 incluso en dry-run (con
 * `public_context.unreversible_statements`); ver `useReconcilePreview` para el auto-reintento.
 */
export function reconcilePartial(
  dbId: number,
  options: ReconcilePartialOptions,
  signal?: AbortSignal,
): Promise<ReconcilePartialResult> {
  return mutateData('POST', `${base(dbId)}/reconcile-partial`, reconcilePartialResultSchema, {
    query: {
      confirm_version: options.confirmVersion,
      dry_run: options.dryRun,
      force: options.force,
    },
    signal,
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
