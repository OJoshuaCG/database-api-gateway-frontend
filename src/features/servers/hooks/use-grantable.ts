import { useMutation } from '@tanstack/react-query'
import type { GrantableRequest } from '@/lib/contracts'
import { checkGrantable } from '../api/servers.api'

/**
 * Pre-chequeo de delegación `WITH GRANT OPTION` 🔌 (§6). Es bajo demanda (mutación), no una
 * query cacheada: se invoca antes de intentar un grant para avisar si no es posible.
 */
export function useCheckGrantable(serverId: number) {
  return useMutation({
    mutationFn: (body: GrantableRequest) => checkGrantable(serverId, body),
  })
}
