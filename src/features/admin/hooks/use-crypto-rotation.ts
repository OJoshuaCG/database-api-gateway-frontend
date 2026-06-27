import { useMutation } from '@tanstack/react-query'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { rotateCrypto } from '../api/admin.api'

/** Rota la DEK y re-cifra todas las credenciales (§12). */
export function useRotateCrypto() {
  const toast = useToast()
  return useMutation({
    mutationFn: () => rotateCrypto(),
    onSuccess: (result) => {
      toast.success(
        'Clave de cifrado rotada',
        `${result.servers_reencrypted} servidor(es) y ${result.server_users_reencrypted} usuario(s) re-cifrados`,
      )
    },
    onError: (error) => toast.error('No se pudo rotar la clave de cifrado', toApiError(error).message),
  })
}
