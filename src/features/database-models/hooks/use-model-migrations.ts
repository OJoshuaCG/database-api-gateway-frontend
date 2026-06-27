import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import type { ModelMigrationCreate, ModelMigrationPatch } from '@/lib/contracts'
import {
  applyAllMigrations,
  createModelMigration,
  deleteModelMigration,
  getModelMigration,
  listModelMigrations,
  updateModelMigration,
  type ApplyAllOptions,
} from '../api/model-migrations.api'

export function useModelMigrations(modelId: number, params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.databaseModels.migrationList(modelId, params),
    queryFn: ({ signal }) => listModelMigrations(modelId, params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useModelMigration(modelId: number, version: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModels.migrationDetail(modelId, version),
    queryFn: ({ signal }) => getModelMigration(modelId, version, signal),
    enabled,
  })
}

export function useCreateModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ModelMigrationCreate) => createModelMigration(modelId, body),
    onSuccess: (migration) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      toast.success('Migración creada', `${migration.version} · ${migration.name}`)
    },
    onError: (error) => toast.error('No se pudo crear la migración', toApiError(error).message),
  })
}

export function useUpdateModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ version, body }: { version: string; body: ModelMigrationPatch }) =>
      updateModelMigration(modelId, version, body),
    onSuccess: (migration) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      queryClient.setQueryData(
        queryKeys.databaseModels.migrationDetail(modelId, migration.version),
        migration,
      )
      toast.success('Migración actualizada', `${migration.version} · ${migration.name}`)
    },
    onError: (error) => toast.error('No se pudo actualizar la migración', toApiError(error).message),
  })
}

export function useDeleteModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (version: string) => deleteModelMigration(modelId, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      toast.success('Migración eliminada')
    },
    onError: (error) => toast.error('No se pudo eliminar la migración', toApiError(error).message),
  })
}

export function useApplyAllMigrations(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: ApplyAllOptions) => applyAllMigrations(modelId, options),
    onSuccess: (result, options) => {
      if (!options.dryRun) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
        const failed = result.results.filter((r) => !r.ok).length
        if (failed > 0) {
          toast.error(
            `Aplicación masiva con ${failed} fallo(s)`,
            `${result.processed} de ${result.total_databases} BD(s) procesada(s)`,
          )
        } else {
          toast.success(
            'Aplicación masiva ejecutada',
            `${result.processed} de ${result.total_databases} BD(s) procesada(s)`,
          )
        }
      }
    },
    onError: (error) => toast.error('No se pudo ejecutar la aplicación masiva', toApiError(error).message),
  })
}
