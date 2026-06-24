import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { AdminOut, LoginIn } from '@/lib/contracts'
import { login } from '../api/auth.api'

/** Mutación de login. Al éxito, siembra la sesión en caché para evitar un refetch. */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentials: LoginIn) => login(credentials),
    onSuccess: (admin: AdminOut) => {
      queryClient.setQueryData(queryKeys.auth.me(), admin)
    },
  })
}
