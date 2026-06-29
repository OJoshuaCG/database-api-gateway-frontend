import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import { isDryRunResult } from '@/lib/contracts'
import {
  applyMigrations,
  getMigrationStatus,
  listMigrationHistory,
  rollbackMigration,
  stampMigration,
  type ApplyOptions,
  type RollbackOptions,
} from '../api/db-migrations.api'

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
        toast.success(
          'Base de datos actualizada',
          `${result.applied_count} migración(es): ${result.from_version ?? '—'} → ${result.to_version ?? '—'}`,
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
        toast.success(
          'Rollback ejecutado',
          `Revertida(s) ${result.reverted_count}: ${result.from_version ?? '—'} → ${result.to_version ?? '—'}`,
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
    mutationFn: (version: string) => stampMigration(dbId, version),
    onSuccess: (_, version) => {
      invalidateAfterRun(queryClient)
      toast.success('Versión marcada', `La BD quedó marcada en ${version} (sin ejecutar SQL)`)
    },
    onError: (error) => toast.error('No se pudo marcar la versión', toApiError(error).message),
  })
}
