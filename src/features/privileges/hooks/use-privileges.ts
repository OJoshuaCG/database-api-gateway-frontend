import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import { listPrivileges, togglePrivilege } from '../api/privileges.api'

export function usePrivileges(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.privileges.list(params),
    queryFn: ({ signal }) => listPrivileges(params, signal),
  })
}

export function useTogglePrivilege() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      togglePrivilege(id, isActive),
    onSuccess: (privilege) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.privileges.all })
      toast.success(
        privilege.is_active ? 'Privilegio activado' : 'Privilegio desactivado',
        `${privilege.engine} · ${privilege.name}`,
      )
    },
    onError: (error) =>
      toast.error('No se pudo actualizar el privilegio', toApiError(error).message),
  })
}
