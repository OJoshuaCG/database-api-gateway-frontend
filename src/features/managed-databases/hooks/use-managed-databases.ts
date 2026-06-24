import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { ManagedDatabaseCreate, ManagedDatabaseUpdate, ReassignOwnerIn } from '@/lib/contracts'
import type { QueryParams } from '@/lib/api/client'
import {
  createManagedDatabase,
  deleteManagedDatabase,
  listManagedDatabases,
  reassignOwner,
  updateManagedDatabase,
} from '../api/managed-databases.api'

export function useManagedDatabases(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.list(params),
    queryFn: ({ signal }) => listManagedDatabases(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useCreateManagedDatabase() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ManagedDatabaseCreate; provision: boolean }) =>
      createManagedDatabase(body, provision),
    onSuccess: (db, { provision }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      if (provision && db.status === 'error') {
        toast.error('La BD quedó en estado «error»', db.notes ?? 'Revisa el detalle en el motor.')
      } else {
        toast.success(
          provision ? 'Base de datos creada y aprovisionada' : 'Base de datos registrada',
          db.name,
        )
      }
    },
    onError: (error) => toast.error('No se pudo crear la base de datos', toApiError(error).message),
  })
}

export function useUpdateManagedDatabase(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ManagedDatabaseUpdate) => updateManagedDatabase(id, body),
    onSuccess: (db) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      toast.success('Base de datos actualizada', db.name)
    },
    onError: (error) =>
      toast.error('No se pudo actualizar la base de datos', toApiError(error).message),
  })
}

export function useDeleteManagedDatabase() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({
      id,
      dropRemote,
      confirmName,
    }: {
      id: number
      dropRemote: boolean
      confirmName?: string
    }) => deleteManagedDatabase(id, { dropRemote, confirmName }),
    onSuccess: (_, { dropRemote }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      toast.success(dropRemote ? 'Base de datos eliminada del motor' : 'Base de datos eliminada')
    },
    onError: (error) =>
      toast.error('No se pudo eliminar la base de datos', toApiError(error).message),
  })
}

export function useReassignOwner(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ReassignOwnerIn; provision: boolean }) =>
      reassignOwner(id, body, provision),
    onSuccess: (db) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      toast.success('Propietario reasignado', db.name)
    },
    onError: (error) =>
      toast.error('No se pudo reasignar el propietario', toApiError(error).message),
  })
}
