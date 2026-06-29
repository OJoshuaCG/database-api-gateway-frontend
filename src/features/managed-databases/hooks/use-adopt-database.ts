import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { AdoptDatabaseIn } from '@/lib/contracts'
import { adoptDatabase } from '../api/managed-databases.api'

/**
 * Adopta una BD existente (Plan 09 §3). Invalida el inventario de BDs y la reconciliación del
 * servidor (la fila debería pasar de `unmanaged` a `managed`).
 */
export function useAdoptDatabase() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AdoptDatabaseIn) => adoptDatabase(body),
    onSuccess: (db) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.reconcile(db.server_id) })
      toast.success('Base de datos adoptada', db.name)
    },
    onError: (error) => toast.error('No se pudo adoptar la base de datos', toApiError(error).message),
  })
}
