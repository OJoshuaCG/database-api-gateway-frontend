import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import {
  API_TOKEN_ERROR_CODES,
  PROJECT_ERROR_CODES,
  type ApiTokenCreate,
  type ApiTokenScopesUpdate,
} from '@/lib/contracts'
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  updateApiTokenScopes,
} from '../api/api-tokens.api'
import { apiTokenErrorMessage } from '../messages'
import { notifyMutationError } from '@/features/auth'

/** Título + detalle de un error, con el copy del módulo cuando lo reconoce. */
function errorToast(title: string, error: unknown): [string, string] {
  const apiError = toApiError(error)
  return [title, apiTokenErrorMessage(apiError) ?? apiError.message]
}

/** `enabled` en `false` sin `access.admin` ni `tokens.own`: el pedido sería un 403 seguro. */
export function useApiTokens(params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.apiTokens.list(params),
    queryFn: ({ signal }) => listApiTokens(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Emisión. **No hace `toast` del secreto ni lo escribe en ninguna query**: el bearer viaja una sola
 * vez y su entrega es una vista propia. El llamador recibe el `ApiTokenCreatedOut` y se encarga
 * de entregarlo.
 *
 * Y `gcTime: 0` porque «no cachearlo» no alcanzaba: la mutación guarda su respuesta en el
 * MutationCache aunque nadie la pida, y ahí el bearer en claro sobrevivía cinco minutos al
 * formulario (que se monta condicionalmente y se desmonta al emitir).
 *
 * Un 422 `project.not_found` significa que el proyecto elegido se borró con el formulario abierto:
 * se invalidan los proyectos para que el selector deje de ofrecerlo sin que nadie recargue.
 */
export function useCreateApiToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ApiTokenCreate) => createApiToken(body),
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
    onError: (error) => {
      if (toApiError(error).code === PROJECT_ERROR_CODES.notFound) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      }
      notifyMutationError(toast, error, ...errorToast('No se pudo emitir el token', error))
    },
  })
}

/**
 * Revocación. Es irreversible y corta el acceso de inmediato.
 *
 * El 409 `already_revoked` se trata como éxito idempotente —el acceso ya estaba cortado, que es el
 * estado que se buscaba— pero con copy que aclara que NO fue esta acción la que lo cortó. Decir
 * «revocado» a secas haría creer que quien apretó el botón fue quien detuvo algo en curso.
 */
export function useRevokeApiToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (tokenPk: number) => revokeApiToken(tokenPk),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      toast.success('Token revocado', `${token.name} (${token.token_id}) ya no tiene acceso.`)
    },
    onError: (error) => {
      const apiError = toApiError(error)
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      if (apiError.code === API_TOKEN_ERROR_CODES.alreadyRevoked) {
        toast.success('Este token ya estaba revocado', 'No fue esta acción la que cortó el acceso.')
        return
      }
      notifyMutationError(toast, error, ...errorToast('No se pudo revocar el token', error))
    },
  })
}

/**
 * Edición de scopes. Sin toast de éxito propio del copy genérico: confirma qué quedó vigente con
 * los scopes que devolvió el servidor, que pueden ser MENOS que los pedidos si intersectó con el
 * techo de agente.
 *
 * El 409 `already_revoked` y el 404 también invalidan el listado: la fila que el operador tenía en
 * pantalla ya no refleja la realidad, y seguir mostrándole «Editar» sobre ella invita a repetir el
 * error. A diferencia de la revocación NO es un éxito: no se cambió nada, así que se informa como
 * error. El 422 `scope_not_allowed` lo maneja el modal (necesita el techo para reofrecerlo).
 */
export function useUpdateApiTokenScopes() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ tokenPk, body }: { tokenPk: number; body: ApiTokenScopesUpdate }) =>
      updateApiTokenScopes(tokenPk, body),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      toast.success(
        'Permisos actualizados',
        `${token.name} (${token.token_id}) ahora tiene: ${token.scopes.join(', ') || 'ninguno'}.`,
      )
    },
    onError: (error) => {
      const code = toApiError(error).code
      if (
        code === API_TOKEN_ERROR_CODES.alreadyRevoked ||
        code === API_TOKEN_ERROR_CODES.notFound
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      }
      notifyMutationError(
        toast,
        error,
        ...errorToast('No se pudieron actualizar los permisos', error),
      )
    },
  })
}
