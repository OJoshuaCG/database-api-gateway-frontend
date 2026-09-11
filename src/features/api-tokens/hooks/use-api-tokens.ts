import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import { API_TOKEN_ERROR_CODES, type ApiTokenCreate } from '@/lib/contracts'
import { createApiToken, listApiTokens, revokeApiToken } from '../api/api-tokens.api'
import { apiTokenErrorMessage } from '../messages'

/** Título + detalle de un error, con el copy del módulo cuando lo reconoce. */
function errorToast(title: string, error: unknown): [string, string] {
  const apiError = toApiError(error)
  return [title, apiTokenErrorMessage(apiError) ?? apiError.message]
}

export function useApiTokens(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.apiTokens.list(params),
    queryFn: ({ signal }) => listApiTokens(params, signal),
    placeholderData: keepPreviousData,
  })
}

/**
 * Emisión. **No hace `toast` del secreto ni lo cachea**: el bearer viaja una sola vez y su entrega
 * es una vista propia. El llamador recibe el `ApiTokenCreatedOut` y se encarga de entregarlo.
 */
export function useCreateApiToken() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ApiTokenCreate) => createApiToken(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
    onError: (error) => toast.error(...errorToast('No se pudo emitir el token', error)),
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
      toast.error(...errorToast('No se pudo revocar el token', error))
    },
  })
}
