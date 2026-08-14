import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import { isDryRunResult, type ReconcilePartialResult } from '@/lib/contracts'
import {
  applyMigrations,
  getMigrationStatus,
  listMigrationHistory,
  reconcilePartial,
  rollbackMigration,
  stampMigration,
  type ApplyOptions,
  type ReconcilePartialOptions,
  type RollbackOptions,
  type StampOptions,
} from '../api/db-migrations.api'
import { getSelectResults, purgeSelectResults } from '../api/select-results.api'

export function useMigrationStatus(dbId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.migrationStatus(dbId),
    queryFn: ({ signal }) => getMigrationStatus(dbId, signal),
    enabled,
  })
}

export function useMigrationHistory(dbId: number, params: QueryParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.migrationHistory(dbId, params),
    queryFn: ({ signal }) => listMigrationHistory(dbId, params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/**
 * Invalida todo lo que cuelga de `managed-databases` tras una operación que toca el motor:
 * estado/historial de migración (`['managed-databases', id, 'migrations', …]`), detalle y
 * listas. Un único prefijo los cubre a todos (mismo patrón que los demás mutadores).
 */
function invalidateAfterRun(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
}

export function useApplyMigrations(dbId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: ApplyOptions) => applyMigrations(dbId, options),
    onSuccess: (result) => {
      // Dry-run es una previsualización: no muta nada ni notifica.
      if (isDryRunResult(result)) return
      invalidateAfterRun(queryClient)
      if (result.failed || result.quarantined) {
        if (result.reconciliation?.fully_reconciled) {
          // Caso feliz de la reconciliación automática: el fallo se deshizo solo (§9).
          toast.push({
            variant: 'warning',
            title: 'La migración falló y se deshizo automáticamente',
            description:
              'La base volvió a la versión anterior sin intervención necesaria. Corrige la migración y reintenta.',
          })
          return
        }
        toast.error(
          'Migraciones aplicadas con errores',
          result.quarantined
            ? 'La BD quedó en cuarentena; revísala y reintenta con «forzar».'
            : undefined,
        )
      } else if (result.no_op || result.applied_count === 0) {
        toast.push({
          variant: 'info',
          title: 'La BD ya estaba al día',
          description: `Versión actual: ${result.to_version ?? '—'}`,
        })
      } else {
        const capture =
          result.select_results_available && result.captured_select_count > 0
            ? ` · ${result.captured_select_count} fila(s) capturada(s)`
            : ''
        toast.success(
          'Base de datos actualizada',
          `${result.applied_count} migración(es): ${result.from_version ?? '—'} → ${result.to_version ?? '—'}${capture}`,
        )
      }
    },
    onError: (error) =>
      toast.error('No se pudieron aplicar las migraciones', toApiError(error).message),
  })
}

export function useRollbackMigration(dbId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: RollbackOptions) => rollbackMigration(dbId, options),
    onSuccess: (result) => {
      invalidateAfterRun(queryClient)
      if (result.failed || result.quarantined) {
        toast.error(
          'Rollback con errores',
          result.quarantined ? 'La BD quedó en cuarentena; revísala.' : undefined,
        )
      } else if (result.no_op || result.reverted_count === 0) {
        toast.push({
          variant: 'info',
          title: 'Nada que revertir',
          description: `Versión actual: ${result.to_version ?? '—'}`,
        })
      } else {
        const capture =
          result.select_results_available && result.captured_select_count > 0
            ? ` · ${result.captured_select_count} fila(s) capturada(s)`
            : ''
        toast.success(
          'Rollback ejecutado',
          `Revertida(s) ${result.reverted_count}: ${result.from_version ?? '—'} → ${result.to_version ?? '—'}${capture}`,
        )
      }
    },
    onError: (error) => toast.error('No se pudo revertir la migración', toApiError(error).message),
  })
}

export function useStampMigration(dbId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: StampOptions) => stampMigration(dbId, options),
    onSuccess: (_, { version, force }) => {
      invalidateAfterRun(queryClient)
      toast.success(
        'Versión marcada',
        `La BD quedó marcada en ${version} (sin ejecutar SQL${force ? ', forzado' : ''})`,
      )
    },
    onError: (error) => toast.error('No se pudo marcar la versión', toApiError(error).message),
  })
}

/** Plan de reconciliación con el flag de si la ejecución exigirá `force` (§9). */
export interface ReconcilePreview {
  plan: ReconcilePartialResult
  /** El dry-run sin `force` respondió 409: hay sentencias sin reverso; ejecutar exige `force`. */
  requiresForce: boolean
}

/**
 * Dry-run de `reconcile-partial` como query (mismo patrón que `useClonePreview`: un POST de
 * previsualización sin efectos). El backend valida `force` ANTES de `dry_run`: si hay sentencias
 * sin reverso responde 409 incluso en dry-run; en ese caso reintentamos automáticamente con
 * `force=true` SOLO para mostrar el plan completo — la decisión de ejecutar con force es del
 * usuario (`requiresForce`). `retry: false` porque el endpoint es 10/min y un preview con 409
 * ya consume dos llamadas.
 */
export function useReconcilePreview(dbId: number, version: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.reconcilePreview(dbId, version),
    queryFn: async ({ signal }): Promise<ReconcilePreview> => {
      try {
        const plan = await reconcilePartial(dbId, { confirmVersion: version, dryRun: true }, signal)
        return { plan, requiresForce: false }
      } catch (error) {
        const apiError = toApiError(error)
        if (apiError.status === 409 && apiError.unreversibleStatements) {
          const plan = await reconcilePartial(
            dbId,
            { confirmVersion: version, dryRun: true, force: true },
            signal,
          )
          return { plan, requiresForce: true }
        }
        throw error
      }
    },
    enabled: enabled && version.length > 0,
    retry: false,
  })
}

/**
 * Ejecución real de `reconcile-partial` (§9): deshace las sentencias aplicadas de la migración
 * parcial (de mayor `seq` a menor). El resultado detallado lo pinta el diálogo; aquí solo el
 * toast resumen + invalidación (estado/historial cambian).
 */
export function useReconcilePartial(dbId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: Omit<ReconcilePartialOptions, 'dryRun'>) =>
      reconcilePartial(dbId, { ...options, dryRun: false }),
    onSuccess: (result) => {
      invalidateAfterRun(queryClient)
      if (result.failed) {
        toast.error(
          'Reconciliación incompleta',
          `Deshechas ${result.undone_count ?? 0} de ${result.statements_to_undo} sentencia(s); revisa el detalle.`,
        )
      } else if (result.fully_reconciled) {
        toast.success(
          'Reconciliación completada',
          `Se deshicieron ${result.undone_count ?? 0} sentencia(s); la BD volvió a la versión anterior.`,
        )
      } else {
        toast.push({
          variant: 'warning',
          title: 'Reconciliación parcial',
          description: `Deshechas ${result.undone_count ?? 0} sentencia(s); quedan ${
            result.remaining_applied_statements ?? '—'
          } aplicadas sin reverso.`,
        })
      }
    },
    onError: (error) => toast.error('No se pudo reconciliar', toApiError(error).message),
  })
}

/**
 * Lectura de la captura de resultados de SELECT (api-reference-v9 §3.5, nuevo). Sin `retry`:
 * el endpoint tiene rate limit propio (20/min) y `items: []` con `200` ya es una respuesta
 * válida (nunca capturado o expirado/purgado, §4.6) — no hay nada que reintentar por 4xx/404.
 */
export function useSelectResults(dbId: number, version: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.selectResults(dbId, version),
    queryFn: ({ signal }) => getSelectResults(dbId, version, signal),
    enabled: enabled && version.length > 0,
    retry: false,
  })
}

/**
 * Purga a demanda las filas capturadas (api-reference-v9 §3.6, nuevo). Idempotente e
 * irreversible; la confirmación de dos pasos la exige la UI (`ConfirmDialog`), no el backend.
 */
export function usePurgeSelectResults(dbId: number, version: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => purgeSelectResults(dbId, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.managedDatabases.selectResults(dbId, version),
      })
      toast.success('Resultados capturados eliminados')
    },
    onError: (error) => toast.error('No se pudieron purgar los resultados', toApiError(error).message),
  })
}
