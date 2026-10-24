import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifyMutationError } from '@/features/auth'
import type { QueryParams } from '@/lib/api/client'
import { toApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import {
  RELEASE_CHANNEL_ERROR_CODES,
  type ChannelPromoteIn,
  type ChannelPromoteOut,
} from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import {
  listBlueprintChannelHistory,
  listBlueprintChannels,
  promoteBlueprintChannel,
  resolveBlueprintChannel,
} from '../api/blueprint-channels.api'

/** Canales de un blueprint con su versión servida (referencia de la caché del inventario). */
export function useBlueprintChannels(modelId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.blueprintChannels.list(modelId),
    queryFn: ({ signal }) => listBlueprintChannels(modelId, signal),
    enabled,
  })
}

/**
 * Lectura EN VIVO de un canal. **Nace deshabilitada** y solo corre cuando la persona la pide: abre
 * una conexión por cada base del entorno y tiene rate limit (20/min), así que dispararla al montar
 * o al reenfocar la ventana gastaría el cupo sin que nadie lo pidiera. Sin `staleTime` infinito a
 * propósito: pedirla de nuevo tiene que volver a leer.
 */
export function useLiveBlueprintChannel(modelId: number, slug: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.blueprintChannels.resolve(modelId, slug),
    queryFn: ({ signal }) => resolveBlueprintChannel(modelId, slug, signal),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 0,
  })
}

/** Historial del puntero de un canal. Solo se pide con el diálogo abierto. */
export function useBlueprintChannelHistory(
  modelId: number,
  slug: string,
  params: QueryParams,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.blueprintChannels.history(modelId, slug, params),
    queryFn: ({ signal }) => listBlueprintChannelHistory(modelId, slug, params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
}

interface PromoteVariables {
  slug: string
  body: ChannelPromoteIn
  /** Solo en un retroceso. */
  confirmSlug?: string
}

/**
 * Promover un canal. Los fallos que la persona puede corregir en el propio diálogo (sin confirmar
 * el retroceso, versión sin revisar, versión de otro blueprint…) se muestran **dentro del
 * diálogo**, así que acá no hay toast para ellos; el resto va a `notifyMutationError`.
 */
export function usePromoteBlueprintChannel(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<ChannelPromoteOut, unknown, PromoteVariables>({
    mutationFn: ({ slug, body, confirmSlug }) =>
      promoteBlueprintChannel(modelId, slug, body, confirmSlug),
    onSuccess: (result, { slug }) => {
      if (result.changed) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.blueprintChannels.list(modelId) })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.blueprintChannels.historyForSlug(modelId, slug),
        })
        // La lectura en vivo abre una conexión por base y tiene rate limit: se marca rancia para
        // que se relea al volver a pedirla, pero no se dispara ahora.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.blueprintChannels.resolveAll(modelId),
          refetchType: 'none',
        })
        toast.success(
          result.event_type === 'demote' ? 'Canal retrocedido.' : 'Canal promovido.',
          `${result.channel_slug}: ${result.from_version ?? 'sin versión'} → ${result.to_version}`,
        )
      } else {
        // No es un fallo ni un cambio: el canal ya estaba ahí y no se escribió nada, así que
        // tampoco hay nada que refrescar.
        toast.success('El canal ya apuntaba a esa versión.', 'No se registró ningún evento.')
      }
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code !== undefined && FORM_LEVEL_CODES.has(apiError.code)) {
        // Un 404/409 de estado del canal deja la pantalla vieja: se refresca.
        void queryClient.invalidateQueries({ queryKey: queryKeys.blueprintChannels.list(modelId) })
        return
      }
      notifyMutationError(toast, error, 'No se pudo promover el canal', apiError.message)
    },
  })
}

/** Códigos que el diálogo de promoción pinta junto al formulario en vez de en un toast. */
const FORM_LEVEL_CODES: ReadonlySet<string> = new Set([
  RELEASE_CHANNEL_ERROR_CODES.promoteBackwardRequiresConfirm,
  RELEASE_CHANNEL_ERROR_CODES.versionUnreviewed,
  RELEASE_CHANNEL_ERROR_CODES.versionNotFound,
  RELEASE_CHANNEL_ERROR_CODES.versionNotInBlueprint,
  RELEASE_CHANNEL_ERROR_CODES.notManual,
  RELEASE_CHANNEL_ERROR_CODES.notFound,
  RELEASE_CHANNEL_ERROR_CODES.pointerInconsistent,
])
