import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  AddHostIn,
  EnginePasswordChangeIn,
  EngineRevealPasswordIn,
  EngineUserCreateIn,
} from '@/lib/contracts'
import {
  addEngineUserHost,
  changeEngineUserPassword,
  createEngineUser,
  deleteEngineUser,
  listGroupedEngineUsers,
  revealEngineUserPassword,
} from '../api/servers.api'

export function useGroupedEngineUsers(serverId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.servers.groupedUsers(serverId),
    queryFn: ({ signal }) => listGroupedEngineUsers(serverId, signal),
    enabled,
  })
}

/**
 * Toda escritura por identidad puede alterar tanto la vista agrupada del servidor como el
 * inventario (`/server-users`, p. ej. `status`/`has_password`): se invalidan ambas.
 */
function useInvalidateEngineUsers(serverId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.servers.groupedUsers(serverId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
  }
}

export function useCreateEngineUser(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EngineUserCreateIn) => createEngineUser(serverId, body),
    onSuccess: (result) => {
      invalidate()
      toast.success('Usuario creado en el motor 🔌', result.username)
    },
    onError: (error) => toast.error('No se pudo crear el usuario', toApiError(error).message),
  })
}

export function useChangeEngineUserPassword(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EnginePasswordChangeIn) => changeEngineUserPassword(serverId, body),
    onSuccess: (result) => {
      invalidate()
      toast.success('Contraseña actualizada 🔌', result.username)
    },
    onError: (error) => toast.error('No se pudo cambiar la contraseña', toApiError(error).message),
  })
}

export function useDeleteEngineUser(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (options: { username: string; host?: string; confirmUsername: string }) =>
      deleteEngineUser(serverId, options),
    onSuccess: (_, { username }) => {
      invalidate()
      toast.success('Usuario eliminado del motor 🔌', username)
    },
    onError: (error) => toast.error('No se pudo eliminar el usuario', toApiError(error).message),
  })
}

export function useAddEngineUserHost(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AddHostIn) => addEngineUserHost(serverId, body),
    onSuccess: (result) => {
      invalidate()
      if (result.grants_error) {
        toast.error(
          `Host «${result.new_host}» creado, pero algún permiso no se copió`,
          result.grants_error,
        )
      } else {
        toast.success(`Host «${result.new_host}» agregado 🔌`, result.username)
      }
    },
    onError: (error) => toast.error('No se pudo agregar el host', toApiError(error).message),
  })
}

/**
 * Revela un secreto efímero: deliberadamente NO invalida ni cachea nada (React Query nunca
 * debe guardar una contraseña en claro). El resultado vive solo en el estado del componente
 * que lo solicitó, mientras el diálogo permanece abierto.
 */
export function useRevealEngineUserPassword(serverId: number) {
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EngineRevealPasswordIn) => revealEngineUserPassword(serverId, body),
    onError: (error) => toast.error('No se pudo revelar la contraseña', toApiError(error).message),
  })
}
