import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import type { DatabaseCreateIn, DatabaseDropIn } from '@/lib/contracts'
import {
  createServerDatabase,
  dropDatabasePreview,
  dropServerDatabase,
} from '../api/server-databases.api'
import { buildDropSuccessDescription } from '../logic'

/**
 * Mutaciones del ciclo de vida de BDs a nivel servidor.
 *
 * Ninguna declara `onError` con toast: los diálogos renderizan el `ApiError` EN LÍNEA con una
 * acción de recuperación por código (§4.2, §4.5), y un toast genérico encima solo duplicaría el
 * mensaje perdiendo la acción. El éxito sí notifica.
 */

/**
 * Invalida todo lo que un cambio en las BDs físicas deja obsoleto: el listado del motor, el
 * inventario (`register`/`inventory_removed` lo tocan) y la reconciliación del servidor.
 *
 * `queryKeys.servers.databases(serverId)` es prefijo de las keys de tablas, snapshot y grantees
 * de ese servidor, así que también caen — que es justo lo que se quiere tras un borrado.
 */
function useInvalidateServerDatabases(serverId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.servers.databases(serverId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.servers.reconcile(serverId) })
  }
}

export function useCreateServerDatabase(serverId: number) {
  const invalidate = useInvalidateServerDatabases(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DatabaseCreateIn) => createServerDatabase(serverId, body),
    onSuccess: (result) => {
      invalidate()
      toast.success(
        result.registered
          ? 'Base de datos creada y registrada en el inventario'
          : 'Base de datos creada en el motor',
        result.database,
      )
    },
  })
}

/**
 * Paso 1 del borrado. Mutación y no query: emite un token de un solo uso con TTL de 2 minutos y
 * está limitada a 10/min, así que NO debe reinvocarse por refetch automático, por temporizador
 * ni al recuperar el foco de la ventana (§6.3). Tampoco se cachea: el token es efímero.
 */
export function useDropDatabasePreview(serverId: number) {
  return useMutation({
    mutationFn: (database: string) => dropDatabasePreview(serverId, database),
  })
}

/**
 * Paso 2 del borrado ⚠️ IRREVERSIBLE. `retry: false` explícito (aunque el cliente global ya no
 * reintenta mutaciones) porque un reintento aquí no es seguro en ningún caso: ante un 504 el
 * DROP pudo haberse ejecutado y haberse perdido la respuesta.
 */
export function useDropServerDatabase(serverId: number) {
  const invalidate = useInvalidateServerDatabases(serverId)
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: ({ database, body }: { database: string; body: DatabaseDropIn }) =>
      dropServerDatabase(serverId, database, body),
    onSuccess: (result) => {
      invalidate()
      toast.success(
        `Base de datos «${result.database}» eliminada`,
        buildDropSuccessDescription(result) || undefined,
      )
    },
  })
}
