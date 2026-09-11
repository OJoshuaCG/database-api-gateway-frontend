import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setUnauthorizedHandler } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { sessionEndReason } from './messages'

/**
 * Conecta el manejo global de 401 del cliente API con React Query: ante un 401 en
 * cualquier endpoint, marca la sesión como cerrada (`me = null`), lo que provoca que
 * `ProtectedRoute` redirija a login. Debe montarse bajo `QueryClientProvider`.
 *
 * Desde v23 §7.3 guarda además **por qué** murió la sesión. El motivo se guarda en la caché de
 * react-query —y no en un módulo con estado— para que el login lo lea de forma reactiva con el
 * mismo mecanismo que todo lo demás, sin montar un contexto propio para un solo string.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    setUnauthorizedHandler((error) => {
      queryClient.setQueryData(queryKeys.auth.me(), null)
      const reason = sessionEndReason(error)
      // Solo se pisa cuando HAY motivo. Un 401 sin código —«nunca hubo sesión»— no debe borrar el
      // «tu sesión alcanzó su duración máxima» que acabamos de guardar: al redirigir, el
      // `/auth/me` de la pantalla de login vuelve a dar 401 y borraría el cartel justo antes de
      // que el usuario lo lea.
      if (reason) queryClient.setQueryData(queryKeys.auth.sessionEndReason(), reason)
    })
    return () => setUnauthorizedHandler(null)
  }, [queryClient])

  return <>{children}</>
}
