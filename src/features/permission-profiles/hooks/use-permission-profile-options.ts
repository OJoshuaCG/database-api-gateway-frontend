import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { listPermissionProfiles } from '../api/permission-profiles.api'

/**
 * Perfiles de permisos activos para poblar selects.
 *
 * **No filtra por motor a propósito** (api-reference-v21 §10): un perfil `mysql` sí puede
 * aplicarse a un servidor MariaDB salvo que use algún privilegio que MariaDB no tenga, así que
 * pedirle al backend `?engine=` de más recortaría opciones legítimas. El recorte por familia y
 * el aviso de «otro motor de la familia» viven en la UI, con `profilesApplicableTo`.
 *
 * Con una sola entrada de caché para todos los motores, además, las pantallas que muestran
 * perfiles de servidores distintos comparten la misma respuesta.
 */
export function usePermissionProfileOptions() {
  return useQuery({
    queryKey: queryKeys.permissionProfiles.list({ options: 'all', active: true }),
    queryFn: ({ signal }) => listPermissionProfiles({ active: true }, signal),
    staleTime: 60_000,
  })
}
