import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { invalidateDatabaseViews } from '../invalidate'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  AgentAccessIn,
  DataCredentialOut,
  EngineType,
  ManagedDatabaseCreate,
  ManagedDatabaseOut,
  ManagedDatabaseUpdate,
  ReassignOwnerIn,
} from '@/lib/contracts'
import { PAGINATION } from '@/lib/contracts'
import type { QueryParams } from '@/lib/api/client'
import {
  approveDataAccess,
  clearDataCredential,
  createManagedDatabase,
  deleteManagedDatabase,
  getDataCredential,
  getManagedDatabase,
  listManagedDatabases,
  provisionDataCredential,
  provisionManagedDatabase,
  reassignOwner,
  requestDataAccess,
  revokeDataAccess,
  setAgentAccess,
  updateManagedDatabase,
  verifyDataCredential,
} from '../api/managed-databases.api'
import { notifyMutationError } from '@/features/auth'
import { engineUserErrorDescription } from '@/features/servers/engine-user-messages'
import { dataAccessErrorMessage } from '../data-access'

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
      invalidateDatabaseViews(queryClient, db.server_id)
      if (provision && db.status === 'error') {
        toast.error('La BD quedó en estado «error»', db.notes ?? 'Revisá el detalle en el motor.')
      } else {
        toast.success(
          provision ? 'Base de datos creada y aprovisionada' : 'Base de datos registrada',
          db.name,
        )
      }
    },
    onError: (error) => notifyMutationError(toast, error, 'No se pudo crear la base de datos'),
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
      // Con el servidor: la ficha deduce la presencia del listado físico, y sin refrescarlo
      // afirmaría que la base recién creada «ya no aparece en el motor».
      invalidateDatabaseViews(queryClient, result.database.server_id)
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
      notifyMutationError(
        toast,
        error,
        MESSAGES_BY_CODE[apiError.code ?? ''] ?? 'No se pudo aprovisionar',
        apiError.message,
      )
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
      invalidateDatabaseViews(queryClient, db.server_id)
      toast.success('Base de datos actualizada', db.name)
    },
    onError: (error) => notifyMutationError(toast, error, 'No se pudo actualizar la base de datos'),
  })
}

/**
 * «Quitar del inventario», opcionalmente con el DROP del motor (`dropRemote`). `serverId` viaja en
 * las variables porque la respuesta del DELETE no trae la base y hace falta para refrescar el
 * listado físico de su servidor (mismo patrón que `useDeleteServerUser`).
 *
 * El toast nombra la consecuencia (R5): «eliminada» a secas, tras quitarla solo del inventario,
 * hacía creer que la base ya no estaba en el motor.
 */
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
      serverId: number
      dropRemote: boolean
      confirmName?: string
    }) => deleteManagedDatabase(id, { dropRemote, confirmName }),
    onSuccess: (_, { serverId, dropRemote }) => {
      invalidateDatabaseViews(queryClient, serverId)
      toast.success(
        dropRemote
          ? 'Base de datos eliminada del motor 🔌'
          : 'Base quitada del inventario (sigue en el motor)',
      )
    },
    onError: (error) => notifyMutationError(toast, error, 'No se pudo quitar del inventario'),
  })
}

/**
 * Opt-in / veto de agentes de UNA base. Invalida las vistas de bases porque el estado vive en la
 * propia fila (badge del listado y de la ficha).
 */
export function useSetAgentAccess(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AgentAccessIn) => setAgentAccess(id, body),
    onSuccess: (db) => {
      invalidateDatabaseViews(queryClient, db.server_id)
      toast.success('Acceso de agentes actualizado', db.name)
    },
    onError: (error) =>
      notifyMutationError(toast, error, 'No se pudo actualizar el acceso de agentes'),
  })
}

export function useReassignOwner(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ReassignOwnerIn; provision: boolean }) =>
      reassignOwner(id, body, provision),
    onSuccess: (db) => {
      invalidateDatabaseViews(queryClient, db.server_id)
      toast.success('Propietario reasignado', db.name)
    },
    // `engineUserErrorDescription` traduce el 403 `engine_user.grant_admin_required` (que nombra la
    // capacidad que falta) y deja pasar el `msg` del backend en cualquier otro caso.
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        'No se pudo reasignar el propietario',
        engineUserErrorDescription(error),
      ),
  })
}

// ── Lectura de DATOS por agentes (api-reference-v35 / v36) ──────────────────────

/**
 * Estado de la credencial de datos y del opt-in de UNA base. `enabled` por parámetro: solo se
 * consulta cuando la sección está abierta (no es un dato que el inventario necesite en cada fila).
 */
export function useDataCredential(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.dataCredential(id),
    queryFn: ({ signal }) => getDataCredential(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Mutación común de la credencial y del opt-in de datos. TODAS devuelven el estado nuevo, que se
 * escribe en la caché de `useDataCredential` sin esperar un refetch. Sin reintentos automáticos
 * (`retry: false`): aprovisionar y verificar tocan un motor real, y aprobar o revocar cambian quién
 * puede leer filas; repetirlas a ciegas no es seguro.
 *
 * `invalidateOnError`: tras una sonda fallida (422) el backend BORRÓ `verified_at`, así que el
 * estado en pantalla quedó viejo y se refresca para que no afirme una verificación que ya no rige.
 */
function useDataCredentialMutation(
  id: number,
  mutationFn: (id: number) => Promise<DataCredentialOut>,
  copy: { success: [title: string, description?: string]; failure: string },
  options: { invalidateOnError?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => mutationFn(id),
    retry: false,
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.managedDatabases.dataCredential(id), status)
      toast.success(copy.success[0], copy.success[1])
    },
    onError: (error) => {
      if (options.invalidateOnError) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.managedDatabases.dataCredential(id),
        })
      }
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        copy.failure,
        dataAccessErrorMessage(apiError) ?? apiError.message,
      )
    },
  })
}

/** 🔌 Crea o re-converge la cuenta SELECT-only de esta base. Queda sin verificar. */
export function useProvisionDataCredential(id: number) {
  return useDataCredentialMutation(id, provisionDataCredential, {
    success: [
      'Credencial de datos generada',
      'Falta verificarla: hasta que la sonda pase, las tools de datos no la usan.',
    ],
    failure: 'No se pudo generar la credencial de datos',
  })
}

/** 🔌 La sonda negativa. Un 422 deja la credencial sin verificar y lista sus motivos. */
export function useVerifyDataCredential(id: number) {
  return useDataCredentialMutation(
    id,
    verifyDataCredential,
    {
      success: [
        'Credencial de datos verificada',
        'El motor confirmó que solo puede leer esta base.',
      ],
      failure: 'No se pudo verificar la credencial de datos',
    },
    { invalidateOnError: true },
  )
}

/** 🔌 Palanca de emergencia: borra la cuenta del motor y cierra el acceso. Idempotente. */
export function useClearDataCredential(id: number) {
  return useDataCredentialMutation(
    id,
    clearDataCredential,
    {
      success: ['Credencial de datos revocada', 'La cuenta se borró del motor.'],
      failure: 'No se pudo revocar la credencial de datos',
    },
    { invalidateOnError: true },
  )
}

export function useRequestDataAccess(id: number) {
  return useDataCredentialMutation(id, requestDataAccess, {
    success: ['Pedido de acceso a datos registrado'],
    failure: 'No se pudo pedir el acceso a datos',
  })
}

export function useApproveDataAccess(id: number) {
  return useDataCredentialMutation(
    id,
    approveDataAccess,
    {
      success: [
        'Acceso a datos aprobado',
        'Las tools de datos aún exigen sonda verde y kill switch.',
      ],
      failure: 'No se pudo aprobar el acceso a datos',
    },
    { invalidateOnError: true },
  )
}

export function useRevokeDataAccess(id: number) {
  return useDataCredentialMutation(id, revokeDataAccess, {
    success: ['Acceso a datos cerrado'],
    failure: 'No se pudo cerrar el acceso a datos',
  })
}
