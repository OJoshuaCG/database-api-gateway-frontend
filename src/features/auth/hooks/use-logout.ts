import { useMutation, useQueryClient } from '@tanstack/react-query'
import { logout } from '../api/auth.api'

/** Mutación de logout. Al éxito, limpia toda la caché de servidor. */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      // Aun si el logout falla (p. ej. sesión ya expirada), descartamos el estado local.
      queryClient.clear()
    },
  })
}
