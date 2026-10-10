import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import {
  INTEGRATION_TOKEN_ERROR_CODES,
  type IntegrationTokenCreate,
  type IntegrationTokenUpdate,
} from '@/lib/contracts'
import { notifyMutationError } from '@/features/auth'
import {
  createIntegrationToken,
  listIntegrationTokens,
  revokeIntegrationToken,
  updateIntegrationToken,
} from '../api/integration-tokens.api'
import { integrationTokenErrorMessage } from '../messages'

/** Título + detalle de un error, con el copy del módulo cuando lo reconoce. */
function errorToast(title: string, error: unknown): [string, string] {
  const apiError = toApiError(error)
  return [title, integrationTokenErrorMessage(apiError) ?? apiError.message]
}

/** `enabled` en `false` sin `access.admin` ni `integration_tokens.own`: sería un 403 seguro. */
export function useIntegrationTokens(params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.integrationTokens.list(params),
    queryFn: ({ signal }) => listIntegrationTokens(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Emisión. **No hace `toast` del secreto ni lo escribe en ninguna query**: el bearer viaja una sola
 * vez y su entrega es una vista propia; el llamador recibe el `IntegrationTokenCreatedOut` y se
 * encarga. `gcTime: 0` porque la mutación guarda su respuesta en el MutationCache aunque nadie la
 * pida, y ahí el bearer en claro sobreviviría al formulario.
 */
export function useCreateIntegrationToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: IntegrationTokenCreate) => createIntegrationToken(body),
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrationTokens.all })
    },
    onError: (error) => {
      notifyMutationError(toast, error, ...errorToast('No se pudo emitir el token', error))
    },
  })
}

/**
 * Edición. El toast confirma qué quedó vigente con los scopes que devolvió el servidor, no con los
 * pedidos. Un 404 o un 409 `already_revoked` invalidan el listado: la fila en pantalla ya no
 * refleja la realidad. A diferencia de la revocación NO es un éxito: no se cambió nada.
 */
export function useUpdateIntegrationToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ tokenPk, body }: { tokenPk: number; body: IntegrationTokenUpdate }) =>
      updateIntegrationToken(tokenPk, body),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrationTokens.all })
      toast.success(
        'Token actualizado',
        `${token.name} (${token.token_id}) ahora tiene: ${token.scopes.join(', ') || 'ninguno'}.`,
      )
    },
    onError: (error) => {
      const code = toApiError(error).code
      if (
        code === INTEGRATION_TOKEN_ERROR_CODES.alreadyRevoked ||
        code === INTEGRATION_TOKEN_ERROR_CODES.notFound
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.integrationTokens.all })
      }
      notifyMutationError(toast, error, ...errorToast('No se pudo actualizar el token', error))
    },
  })
}

/**
 * Revocación: irreversible y corta el acceso de inmediato. El 409 `already_revoked` se trata como
 * éxito idempotente con copy que aclara que NO fue esta acción la que cortó el acceso.
 */
export function useRevokeIntegrationToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (tokenPk: number) => revokeIntegrationToken(tokenPk),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrationTokens.all })
      toast.success('Token revocado', `${token.name} (${token.token_id}) ya no tiene acceso.`)
    },
    onError: (error) => {
      const apiError = toApiError(error)
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrationTokens.all })
      if (apiError.code === INTEGRATION_TOKEN_ERROR_CODES.alreadyRevoked) {
        toast.success('Este token ya estaba revocado', 'No fue esta acción la que cortó el acceso.')
        return
      }
      notifyMutationError(toast, error, ...errorToast('No se pudo revocar el token', error))
    },
  })
}
