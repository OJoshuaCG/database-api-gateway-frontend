import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { invalidateDatabaseViews } from '../invalidate'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  EngineType,
  ManagedDatabaseCreate,
  ManagedDatabaseOut,
  ManagedDatabaseUpdate,
  ReassignOwnerIn,
} from '@/lib/contracts'
import { PAGINATION } from '@/lib/contracts'
import type { QueryParams } from '@/lib/api/client'
import {
  createManagedDatabase,
  deleteManagedDatabase,
  getManagedDatabase,
  listManagedDatabases,
  provisionManagedDatabase,
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

/** Detalle en vivo de una BD gestionada (p. ej. para conocer su `model_id` actual). */
export function useManagedDatabase(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.detail(id),
    queryFn: ({ signal }) => getManagedDatabase(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Lista (casi) completa de BDs gestionadas para poblar selects, opcionalmente filtrada por
 * motor (feature `schema-comparisons`: el selector de origen/target necesita elegir dos BDs del
 * mismo motor). Mirror de `useServerOptions`/`useDatabaseModelOptions`.
 */
export function useManagedDatabaseOptions(engine?: EngineType, enabled = true) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.list({ options: 'all', engine }),
    queryFn: ({ signal }) =>
      listManagedDatabases({ page: 1, size: PAGINATION.maxSize, engine }, signal),
    enabled,
    staleTime: 30_000,
    select: (page): ManagedDatabaseOut[] => page.items,
  })
}

/**
 * BDs adoptadas de UN servidor (feature `schema-comparisons`, selector "por servidor"): se
 * cruza por `id` contra `GET /servers/{id}/reconcile` para resolver el `model_id` de las BDs
 * en vivo que sí están en el inventario. `staleTime` corto: el estado de adopción puede cambiar
 * por fuera mientras el selector está abierto.
 */
export function useManagedDatabasesByServer(serverId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.list({ options: 'by-server', server_id: serverId }),
    queryFn: ({ signal }) =>
      listManagedDatabases({ page: 1, size: PAGINATION.maxSize, server_id: serverId }, signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0,
    staleTime: 10_000,
    select: (page): ManagedDatabaseOut[] => page.items,
  })
}

export function useCreateManagedDatabase() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ManagedDatabaseCreate; provision: boolean }) =>
      createManagedDatabase(body, provision),
    onSuccess: (db, { provision }) => {
      invalidateDatabaseViews(queryClient)
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

/**
 * Aprovisiona en el motor 🔌 una BD que ya está en el inventario pero no existe físicamente
 * (`pending`, o `error` si el DDL del alta falló).
 *
 * Los errores se distinguen por `public_context.code` y no por el texto del mensaje: es el
 * único canal estable, y viaja también en producción (`context` solo existe en desarrollo).
 */
export function useProvisionManagedDatabase() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, allowRecreate }: { id: number; allowRecreate?: boolean }) =>
      provisionManagedDatabase(id, { allowRecreate }),
    onSuccess: (result) => {
      invalidateDatabaseViews(queryClient)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.managedDatabases.migrationStatus(result.database.id),
      })
      if (result.provisioned) {
        toast.success('Base de datos creada en el motor', result.database.name)
      } else {
        // No es un fallo: otra llamada simultánea la creó primero y esta solo reconcilió.
        toast.success(
          'La base ya había sido creada',
          `Se reconcilió el estado de ${result.database.name}.`,
        )
      }
    },
    onError: (error) => {
      const apiError = toApiError(error)
      toast.error(MESSAGES_BY_CODE[apiError.code ?? ''] ?? 'No se pudo aprovisionar', apiError.message)
    },
  })
}

/**
 * Títulos por código de error de aprovisionamiento. El detalle accionable ya viene en el
 * `message` del backend, así que acá solo se nombra el problema en pocas palabras.
 */
const MESSAGES_BY_CODE: Record<string, string> = {
  'managed_database.exists_in_engine': 'La base ya existe en el motor',
  'managed_database.quarantined_not_missing': 'La base existe pero está en cuarentena',
  'managed_database.already_active': 'El inventario ya la marca activa',
  'managed_database.archived': 'La base está archivada',
}

export function useUpdateManagedDatabase(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ManagedDatabaseUpdate) => updateManagedDatabase(id, body),
    onSuccess: (db) => {
      invalidateDatabaseViews(queryClient)
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
      invalidateDatabaseViews(queryClient)
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
      invalidateDatabaseViews(queryClient)
      toast.success('Propietario reasignado', db.name)
    },
    onError: (error) =>
      toast.error('No se pudo reasignar el propietario', toApiError(error).message),
  })
}
