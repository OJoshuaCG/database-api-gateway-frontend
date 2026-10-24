import { fetchData, fetchList, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  channelPointerEventOutSchema,
  channelPromoteOutSchema,
  channelResolutionOutSchema,
  type ChannelPointerEventOut,
  type ChannelPromoteIn,
  type ChannelPromoteOut,
  type ChannelResolutionOut,
  type Page,
} from '@/lib/contracts'

const base = (modelId: number) => `/database-models/${modelId}/channels`
const channelPath = (modelId: number, slug: string) =>
  `${base(modelId)}/${encodeURIComponent(slug)}`

/**
 * `GET /database-models/{id}/channels` — NO paginado. Cada canal con la versión que sirve para este
 * blueprint. Los canales `derived` y la referencia de los manuales salen de la CACHÉ del
 * inventario (`source: inventory_cache`): es para pantalla, nunca para decidir.
 */
export function listBlueprintChannels(
  modelId: number,
  signal?: AbortSignal,
): Promise<ChannelResolutionOut[]> {
  return fetchList(base(modelId), channelResolutionOutSchema, { signal })
}

/**
 * `GET .../channels/{slug}/resolve` — lectura EN VIVO y tolerante (abre una conexión por cada base
 * del entorno enlazado; 20/min). Responde 200 aunque no resuelva: `resolved: false` + `code`.
 */
export function resolveBlueprintChannel(
  modelId: number,
  slug: string,
  signal?: AbortSignal,
): Promise<ChannelResolutionOut> {
  return fetchData(`${channelPath(modelId, slug)}/resolve`, channelResolutionOutSchema, { signal })
}

/**
 * `POST .../channels/{slug}/promote` — apunta el canal manual a una versión REVISADA del blueprint.
 * Pide `blueprints.promote` + step-up.
 *
 * `confirmSlug` va como **query param** y solo hace falta para un RETROCESO (versión menor que la
 * actual): sin él el backend responde 409 `release_channel.promote_backward_requires_confirm`.
 */
export function promoteBlueprintChannel(
  modelId: number,
  slug: string,
  body: ChannelPromoteIn,
  confirmSlug?: string,
): Promise<ChannelPromoteOut> {
  return mutateData('POST', `${channelPath(modelId, slug)}/promote`, channelPromoteOutSchema, {
    body,
    query: { confirm_slug: confirmSlug },
  })
}

/** `GET .../channels/{slug}/history` — PAGINADO, del evento más reciente al más antiguo. */
export function listBlueprintChannelHistory(
  modelId: number,
  slug: string,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ChannelPointerEventOut>> {
  return fetchPage(`${channelPath(modelId, slug)}/history`, channelPointerEventOutSchema, {
    query: params,
    signal,
  })
}
