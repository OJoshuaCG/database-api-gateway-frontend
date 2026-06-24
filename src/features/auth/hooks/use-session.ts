import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { ApiError } from '@/lib/api/errors'
import { getMe } from '../api/auth.api'

/**
 * Estado de la sesión, derivado de `GET /auth/me`. No reintenta: un 401 significa
 * "no autenticado" de forma determinista.
 */
export function useSession() {
  const query = useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: ({ signal }) => getMe(signal),
    retry: false,
    staleTime: 60_000,
  })

  const isUnauthenticated =
    query.data === null ||
    (query.isError && query.error instanceof ApiError && query.error.status === 401)

  return {
    admin: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: Boolean(query.data),
    isUnauthenticated,
    error: query.error,
    refetch: query.refetch,
  }
}
