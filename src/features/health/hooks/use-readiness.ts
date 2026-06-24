import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { getReadiness, isHealthConfigured } from '../api/health.api'

/** Sondea el readiness del backend cada 30 s. Si no está configurado, queda inactivo. */
export function useReadiness() {
  return useQuery({
    queryKey: queryKeys.health.readiness(),
    queryFn: ({ signal }) => getReadiness(signal),
    enabled: isHealthConfigured(),
    refetchInterval: 30_000,
    retry: false,
    staleTime: 15_000,
  })
}
