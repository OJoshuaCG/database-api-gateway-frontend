import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { ApplyProfileRequest, GrantRequest, RevokeRequest } from '@/lib/contracts'
import {
  applyProfile,
  grantPrivileges,
  listUserGrants,
  revokePrivileges,
} from '../api/server-users.api'

/** Permisos efectivos del usuario (introspección del motor) 🔌. PG: `database` obligatorio. */
export function useUserGrants(id: number, database: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.serverUsers.grants(id, database ?? null),
    queryFn: ({ signal }) => listUserGrants(id, database, signal),
    enabled,
  })
}

/** Invalida todos los grants del usuario (cualquier `database`). */
function invalidateGrants(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['server-users', id, 'grants'] })
}

export function useGrantPrivileges(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: GrantRequest) => grantPrivileges(id, body),
    onSuccess: (result) => {
      void invalidateGrants(queryClient, id)
      toast.success(
        'Privilegios otorgados',
        `${result.privileges.join(', ')} a nivel ${result.level}`,
      )
    },
    onError: (error) => toast.error('No se pudieron otorgar los privilegios', toApiError(error).message),
  })
}

export function useRevokePrivileges(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, confirmGrantee }: { body: RevokeRequest; confirmGrantee?: string }) =>
      revokePrivileges(id, body, confirmGrantee),
    onSuccess: () => {
      void invalidateGrants(queryClient, id)
      toast.success('Privilegios revocados')
    },
    onError: (error) => toast.error('No se pudieron revocar los privilegios', toApiError(error).message),
  })
}

export function useApplyProfile(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ profileId, body }: { profileId: number; body: ApplyProfileRequest }) =>
      applyProfile(id, profileId, body),
    onSuccess: (result) => {
      void invalidateGrants(queryClient, id)
      if (result.errors.length > 0) {
        toast.error(
          `Perfil aplicado con ${result.errors.length} error(es)`,
          `${result.grants_applied} grant(s) aplicado(s). ${result.errors.join('; ')}`,
        )
      } else {
        toast.success(
          'Perfil aplicado',
          `${result.profile_name}: ${result.grants_applied} grant(s) aplicado(s)`,
        )
      }
    },
    onError: (error) => toast.error('No se pudo aplicar el perfil', toApiError(error).message),
  })
}
