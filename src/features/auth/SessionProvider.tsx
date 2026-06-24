import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setUnauthorizedHandler } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'

/**
 * Conecta el manejo global de 401 del cliente API con React Query: ante un 401 en
 * cualquier endpoint, marca la sesión como cerrada (`me = null`), lo que provoca que
 * `ProtectedRoute` redirija a login. Debe montarse bajo `QueryClientProvider`.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(queryKeys.auth.me(), null)
    })
    return () => setUnauthorizedHandler(null)
  }, [queryClient])

  return <>{children}</>
}
