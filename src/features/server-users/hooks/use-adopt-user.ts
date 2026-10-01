import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import { engineUserErrorDescription } from '@/features/servers/engine-user-messages'
import type { AdoptUserIn } from '@/lib/contracts'
import { adoptUser } from '../api/server-users.api'
import { notifyMutationError } from '@/features/auth'

/**
 * Adopta un usuario existente (Plan 09 §4). Nace sin password (`has_password=false`). Invalida el
 * inventario de usuarios, la reconciliación y la vista agrupada del servidor (pasa a `adopted`).
 */
export function useAdoptUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AdoptUserIn) => adoptUser(body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.reconcile(user.server_id) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.servers.groupedUsers(user.server_id),
      })
      toast.success('Usuario adoptado', `${user.username}${user.host ? `@${user.host}` : ''}`)
    },
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        'No se pudo adoptar el usuario',
        engineUserErrorDescription(error),
      ),
  })
}
