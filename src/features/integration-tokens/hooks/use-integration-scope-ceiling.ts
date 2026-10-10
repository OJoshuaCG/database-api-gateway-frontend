import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { getIntegrationCeiling } from '../api/integration-tokens.api'

/**
 * Techo de scopes del usuario (`GET /integration-tokens/ceiling`). Es la ÚNICA fuente de lo que el
 * selector ofrece: no se mezcla con `GET /authz/catalog` porque los scopes de integración no son
 * capacidades y no aparecen ahí.
 *
 * `enabled` en `false` sin permiso para administrar tokens: el pedido sería un 403 seguro.
 */
export function useIntegrationScopeCeiling(enabled = true) {
  return useQuery({
    queryKey: queryKeys.integrationTokens.ceiling(),
    queryFn: ({ signal }) => getIntegrationCeiling(signal),
    enabled,
  })
}
