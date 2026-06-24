import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './errors'

/**
 * No reintentar errores de cliente (4xx): son deterministas (validación, 404, 409, 401).
 * Sí reintentar (limitado) errores de red y de motor destino (0/502/503/504), que pueden
 * ser transitorios.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
