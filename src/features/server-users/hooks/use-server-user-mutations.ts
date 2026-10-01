import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import { engineUserErrorDescription } from '@/features/servers/engine-user-messages'
import type { ServerUserCreate, ServerUserUpdate } from '@/lib/contracts'
import { createServerUser, deleteServerUser, updateServerUser } from '../api/server-users.api'

/**
 * El inventario no es la única vista de un usuario: la tabla del servidor y la ficha leen la
 * vista AGRUPADA (`servers.groupedUsers`), que cruza motor e inventario y muestra estado, notas y
 * «activo». Invalidar solo `serverUsers.all` dejaba esas dos vistas mostrando al usuario borrado,
 * o con sus notas viejas, hasta recargar.
 */
function useInvalidateServerUserViews() {
  const queryClient = useQueryClient()
  return (serverId: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.servers.groupedUsers(serverId) })
  }
}

export function useCreateServerUser() {
  const invalidate = useInvalidateServerUserViews()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ServerUserCreate; provision: boolean }) =>
      createServerUser(body, provision),
    onSuccess: (user, { provision }) => {
      invalidate(user.server_id)
      toast.success(
        provision ? 'Usuario creado y aprovisionado' : 'Usuario creado en el inventario',
        user.username,
      )
    },
    onError: (error) =>
      toast.error('No se pudo crear el usuario', engineUserErrorDescription(error)),
  })
}

export function useUpdateServerUser(id: number) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateServerUserViews()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ body, provision }: { body: ServerUserUpdate; provision: boolean }) =>
      updateServerUser(id, body, provision),
    onSuccess: (user) => {
      invalidate(user.server_id)
      queryClient.setQueryData(queryKeys.serverUsers.detail(id), user)
      toast.success('Usuario actualizado', user.username)
    },
    onError: (error) =>
      toast.error('No se pudo actualizar el usuario', engineUserErrorDescription(error)),
  })
}

/**
 * `serverId` viaja en las variables porque la respuesta del DELETE no trae el usuario y hace
 * falta para invalidar la vista agrupada de su servidor.
 */
export function useDeleteServerUser() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateServerUserViews()
  const toast = useToast()
  return useMutation({
    mutationFn: ({
      id,
      dropRemote,
      confirmUsername,
    }: {
      id: number
      serverId: number
      dropRemote: boolean
      confirmUsername?: string
    }) => deleteServerUser(id, { dropRemote, confirmUsername }),
    onSuccess: (_, { id, serverId, dropRemote }) => {
      // Se QUITA (no se invalida) el detalle: el registro ya no existe, y dejarlo en caché haría
      // que la invalidación de `serverUsers.all` de abajo lo refetcheara. NO evita del todo el
      // 404: si una ficha abierta lo observa, su observador recrea la query en el siguiente render
      // y la pide una vez más, hasta que la vista agrupada quita el `server_user_id` de la
      // identidad y la ficha deshabilita la consulta. Mientras tanto, las pestañas que dependen
      // del registro pueden mostrar ese error un instante.
      queryClient.removeQueries({ queryKey: queryKeys.serverUsers.detail(id) })
      invalidate(serverId)
      toast.success(
        dropRemote ? 'Usuario eliminado del motor 🔌' : 'Usuario quitado del inventario',
      )
    },
    onError: (error) =>
      toast.error('No se pudo eliminar el usuario', engineUserErrorDescription(error)),
  })
}
