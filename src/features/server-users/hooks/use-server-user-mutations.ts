import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { ServerUserCreate, ServerUserUpdate } from '@/lib/contracts'
import { createServerUser, deleteServerUser, updateServerUser } from '../api/server-users.api'

export function useCreateServerUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ServerUserCreate; provision: boolean }) =>
      createServerUser(body, provision),
    onSuccess: (user, { provision }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      toast.success(
        provision ? 'Usuario creado y aprovisionado' : 'Usuario creado en el inventario',
        user.username,
      )
    },
    onError: (error) => toast.error('No se pudo crear el usuario', toApiError(error).message),
  })
}

export function useUpdateServerUser(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ServerUserUpdate; provision: boolean }) =>
      updateServerUser(id, body, provision),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      queryClient.setQueryData(queryKeys.serverUsers.detail(id), user)
      toast.success('Usuario actualizado', user.username)
    },
    onError: (error) => toast.error('No se pudo actualizar el usuario', toApiError(error).message),
  })
}

export function useDeleteServerUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({
      id,
      dropRemote,
      confirmUsername,
    }: {
      id: number
      dropRemote: boolean
      confirmUsername?: string
    }) => deleteServerUser(id, { dropRemote, confirmUsername }),
    onSuccess: (_, { dropRemote }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
      toast.success(dropRemote ? 'Usuario eliminado del motor' : 'Usuario eliminado del inventario')
    },
    onError: (error) => toast.error('No se pudo eliminar el usuario', toApiError(error).message),
  })
}
