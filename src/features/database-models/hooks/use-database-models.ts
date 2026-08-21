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
  refreshModelDatabases,
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

/**
 * BDs del blueprint **con su estado de despliegue** (versión actual, pendientes, parcial).
 *
 * Sustituye a lo que antes exigía una llamada por BD a `/migrations/status`, cada una con su
 * conexión al motor: ahora la tabla entera sale de una respuesta servida con datos locales.
 */
export function useModelDatabases(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModels.databases(id),
    queryFn: ({ signal }) => listModelDatabases(id, signal),
    enabled,
  })
}

/**
 * Relee la versión REAL de cada BD y resincroniza la copia del gateway. 🔌
 *
 * El endpoint es `POST` porque tiene efectos: abre conexiones y reescribe `model_version`.
 * Colgarlo del `GET` obligaba además a limitar por tasa la lectura barata, que es la que la UI
 * repite al reenfocar la ventana.
 */
export function useRefreshModelDatabases(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => refreshModelDatabases(id),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.databaseModels.databases(id), data)
      toast.success('Estado actualizado', `${data.length} BD(s) releídas del motor`)
    },
    onError: (error) => toast.error('No se pudo releer el estado', toApiError(error).message),
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
