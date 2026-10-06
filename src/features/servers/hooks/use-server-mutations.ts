import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  ReadonlyCredentialIn,
  ReadonlyProcGrantIn,
  ServerCreate,
  ServerUpdate,
} from '@/lib/contracts'
import {
  clearReadonlyCredential,
  createServer,
  deleteServer,
  provisionReadonlyCredential,
  setReadonlyCredential,
  setReadonlyProcGrant,
  testConnection,
  updateServer,
} from '../api/servers.api'
import { serverRebindErrorMessage } from '../server-rebind'
import {
  procGrantOutcome,
  readonlyCredentialErrorMessage,
  readonlyProcGrantErrorMessage,
} from '../readonly-credential'
import { notifyMutationError, scopeHasGrantsMessage } from '@/features/auth'

export function useCreateServer() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ServerCreate) => createServer(body),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success('Servidor registrado', server.name)
    },
    onError: (error) => notifyMutationError(toast, error, 'No se pudo registrar el servidor'),
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
    onError: (error) => {
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        'No se pudo actualizar el servidor',
        serverRebindErrorMessage(apiError) ?? apiError.message,
      )
    },
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
    onError: (error) => {
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        'No se pudo eliminar el servidor',
        scopeHasGrantsMessage(apiError, 'server') ?? apiError.message,
      )
    },
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
    onError: (error) => notifyMutationError(toast, error, 'No se pudo conectar al servidor'),
  })
}

// ── Credencial de solo lectura del MCP (api-reference-v30) ──────────────────
// Las tres piden `servers.admin` + step-up. El step-up no se pide acá: si falta, el 403
// `access.step_up_required` lo resuelve `runRequest` (pide la contraseña y reenvía una vez).

/**
 * Alta o reemplazo. `gcTime: 0` porque las `variables` de la mutación son la contraseña en claro:
 * con el gc por defecto quedarían cinco minutos en la caché de TanStack después de cerrar el modal.
 * El modal además llama `reset()` al terminar.
 */
export function useSetReadonlyCredential(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ReadonlyCredentialIn) => setReadonlyCredential(id, body),
    gcTime: 0,
    onSuccess: (server) => {
      queryClient.setQueryData(queryKeys.servers.detail(id), server)
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success(
        'Credencial de solo lectura guardada',
        'Falta verificarla: hasta que la sonda pase, el MCP no la usa.',
      )
    },
    onError: (error) =>
      notifyMutationError(toast, error, 'No se pudo guardar la credencial de solo lectura'),
  })
}

/**
 * Aprovisionamiento automático 🔌 (api-reference-v32): el gateway crea o rota la cuenta de solo
 * lectura en el motor. Sin reintentos automáticos (`retry: false`): es una escritura sobre un
 * motor de un tercero y repetirla rota otra vez la contraseña. Un 422 `readonly_probe_failed` no
 * es un fallo de la UI: el panel lista sus `violations`; el servidor queda sin verificar.
 */
export function useProvisionReadonlyCredential(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => provisionReadonlyCredential(id),
    retry: false,
    onSuccess: (server) => {
      queryClient.setQueryData(queryKeys.servers.detail(id), server)
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success(
        'Credencial de solo lectura generada',
        'El motor confirmó que no puede escribir. El MCP ya puede leer todas las bases de este servidor.',
      )
    },
    onError: (error) => {
      // Un 422 deja la credencial registrada pero sin verificar: se refresca para reflejarlo.
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        'No se pudo generar la credencial de solo lectura',
        readonlyCredentialErrorMessage(apiError) ?? apiError.message,
      )
    },
  })
}

/**
 * Enciende o apaga `SELECT ON mysql.proc` 🔌 para la credencial de solo lectura. Sin reintentos
 * automáticos (`retry: false`): con credencial propia re-aprovisiona la cuenta en el motor de un
 * tercero. Un `engine_grant: 'not_alterable'` NO es un fallo: el cambio no llegó al motor y el
 * panel lo explica con un Callout persistente, así que ese caso no lanza toast de éxito. Si el
 * backend falla, la bandera queda como estaba y la credencial pudo quedar sin verificar: se
 * refresca el servidor igual.
 */
export function useSetReadonlyProcGrant(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ReadonlyProcGrantIn) => setReadonlyProcGrant(id, body),
    retry: false,
    onSuccess: (result, body) => {
      queryClient.setQueryData(queryKeys.servers.detail(id), result.server)
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      const outcome = procGrantOutcome(result.engine_grant, body.enabled)
      if (outcome.tone === 'success') toast.success(outcome.title, outcome.description)
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        'No se pudo cambiar la lectura de cuerpos de rutinas',
        readonlyProcGrantErrorMessage(apiError) ?? apiError.message,
      )
    },
  })
}

/** Quitarla deja el servidor fuera del MCP. Idempotente en el backend. */
export function useClearReadonlyCredential(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => clearReadonlyCredential(id),
    onSuccess: (server) => {
      queryClient.setQueryData(queryKeys.servers.detail(id), server)
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success('Credencial de solo lectura quitada', 'El MCP ya no puede leer este servidor.')
    },
    onError: (error) =>
      notifyMutationError(toast, error, 'No se pudo quitar la credencial de solo lectura'),
  })
}

/**
 * Sonda negativa 🔌: conecta con la credencial de solo lectura y exige que el motor observe que no
 * puede escribir. Un 422 `server.readonly_probe_failed` no es un fallo de la UI: es el resultado
 * que importa, y el panel lista sus `violations` para el DBA.
 */
export function useTestReadonlyConnection(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => testConnection(id, 'readonly'),
    onSuccess: () => {
      // El `ServerOut` trae el `readonly_verified_at` nuevo: se refresca para que el estado cambie.
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      toast.success('Credencial verificada', 'El motor confirmó que no puede escribir.')
    },
    onError: (error) => {
      // La sonda pudo haber BORRADO la verificación anterior al fallar: se refresca igual.
      void queryClient.invalidateQueries({ queryKey: queryKeys.servers.all })
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        'La credencial no pasó la verificación',
        readonlyCredentialErrorMessage(apiError) ?? apiError.message,
      )
    },
  })
}
