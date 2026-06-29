import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { DatabaseModelCreate, DatabaseModelUpdate } from '@/lib/contracts'
import type { QueryParams } from '@/lib/api/client'
import {
  createDatabaseModel,
  deleteDatabaseModel,
  getDatabaseModel,
  listDatabaseModels,
  listModelDatabases,
  updateDatabaseModel,
} from '../api/database-models.api'

export function useDatabaseModels(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.databaseModels.list(params),
    queryFn: ({ signal }) => listDatabaseModels(params, signal),
    placeholderData: keepPreviousData,
  })
}

/** Detalle de un blueprint por id (para la página de versiones). */
export function useDatabaseModel(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.databaseModels.detail(id),
    queryFn: ({ signal }) => getDatabaseModel(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

export function useModelDatabases(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModels.databases(id),
    queryFn: ({ signal }) => listModelDatabases(id, signal),
    enabled,
  })
}

export function useCreateDatabaseModel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DatabaseModelCreate) => createDatabaseModel(body),
    onSuccess: (model) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success('Blueprint creado', model.name)
    },
    onError: (error) => toast.error('No se pudo crear el blueprint', toApiError(error).message),
  })
}

export function useUpdateDatabaseModel(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DatabaseModelUpdate) => updateDatabaseModel(id, body),
    onSuccess: (model) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success('Blueprint actualizado', model.name)
    },
    onError: (error) =>
      toast.error('No se pudo actualizar el blueprint', toApiError(error).message),
  })
}

export function useDeleteDatabaseModel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteDatabaseModel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success('Blueprint eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el blueprint', toApiError(error).message),
  })
}
