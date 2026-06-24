import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { ServerCreate, ServerUpdate } from '@/lib/contracts'
import { createServer, deleteServer, testConnection, updateServer } from '../api/servers.api'

export function useCreateServer() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ServerCreate) => createServer(body),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success('Servidor registrado', server.name)
    },
    onError: (error) => toast.error('No se pudo registrar el servidor', toApiError(error).message),
  })
}

export function useUpdateServer(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ServerUpdate) => updateServer(id, body),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      queryClient.setQueryData(queryKeys.servers.detail(id), server)
      toast.success('Servidor actualizado', server.name)
    },
    onError: (error) => toast.error('No se pudo actualizar el servidor', toApiError(error).message),
  })
}

export function useDeleteServer() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success('Servidor eliminado del inventario')
    },
    onError: (error) => toast.error('No se pudo eliminar el servidor', toApiError(error).message),
  })
}

/** `test-connection` 🔌: verifica conectividad y refresca el estado del servidor. */
export function useTestConnection(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => testConnection(id),
    onSuccess: (info) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success(
        info.ok ? 'Conexión exitosa' : 'Conexión fallida',
        info.ok ? `${info.dialect} ${info.server_version ?? ''}`.trim() : undefined,
      )
    },
    onError: (error) => toast.error('No se pudo conectar al servidor', toApiError(error).message),
  })
}
