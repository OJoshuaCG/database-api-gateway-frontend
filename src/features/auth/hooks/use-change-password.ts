import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { PasswordChangeIn } from '@/lib/contracts'
import { changeOwnPassword } from '../api/auth.api'

/**
 * Mutación del cambio de contraseña propia.
 *
 * Al éxito invalida `/auth/me` y la lista de sesiones: la sesión de esta pestaña es NUEVA (el
 * `sid` rotó) y todas las demás quedaron cerradas, así que lo que hubiera en caché de las dos
 * describe un estado que ya no existe. El CSRF no se toca: se relee de la cookie en cada request.
 */
export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PasswordChangeIn) => changeOwnPassword(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() })
    },
  })
}
