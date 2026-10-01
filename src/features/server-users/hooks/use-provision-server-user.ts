import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import { engineUserErrorDescription } from '@/features/servers/engine-user-messages'
import type { ServerUserFullCreate } from '@/lib/contracts'
import { provisionServerUser } from '../api/server-users.api'
import { notifyMutationError } from '@/features/auth'

/**
 * Crea + aprovisiona el usuario + aplica `initial_grants` en una sola llamada 🔌 (§7).
 * Los grants son best-effort: un fallo no revierte la creación, así que los `grant_results`
 * fallidos se comunican como advertencia (nunca un éxito genérico que los oculte).
 */
export function useProvisionServerUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ServerUserFullCreate) => provisionServerUser(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      // La tabla del servidor y la ficha del usuario leen la vista AGRUPADA por username, que
      // cuelga de otro tronco de clave (`['servers', id, 'grouped-users']`). Sin esto, un usuario
      // recién creado aparece en «Usuarios del motor» del sidebar y no en la pestaña del
      // servidor, hasta que venza el `staleTime`.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.servers.groupedUsers(result.user.server_id),
      })
      const failed = result.grant_results.filter((grant) => !grant.success)
      if (failed.length > 0) {
        toast.push({
          variant: 'warning',
          title: `Usuario '${result.user.username}' aprovisionado, pero ${failed.length} grant(s) fallaron`,
          description: failed
            .map(
              (grant) =>
                `${grant.level}${grant.object ? ` (${grant.object})` : ''}: ${grant.error ?? 'error desconocido'}`,
            )
            .join(' · '),
        })
      } else {
        toast.success(
          `Usuario '${result.user.username}' aprovisionado`,
          `${result.grants_applied} grant(s) aplicado(s)`,
        )
      }
    },
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        'No se pudo aprovisionar el usuario',
        engineUserErrorDescription(error),
      ),
  })
}
