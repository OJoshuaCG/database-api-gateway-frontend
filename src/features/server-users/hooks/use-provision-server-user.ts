import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { ServerUserFullCreate } from '@/lib/contracts'
import { provisionServerUser } from '../api/server-users.api'

/** Crea + aprovisiona el usuario + aplica `initial_grants` en una sola llamada 🔌 (§7). */
export function useProvisionServerUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ServerUserFullCreate) => provisionServerUser(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      toast.success(
        `Usuario '${result.user.username}' aprovisionado`,
        `${result.grants_applied} grant(s) aplicado(s)`,
      )
    },
    onError: (error) => toast.error('No se pudo aprovisionar el usuario', toApiError(error).message),
  })
}
