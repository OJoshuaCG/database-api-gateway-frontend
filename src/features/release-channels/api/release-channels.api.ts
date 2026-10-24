import { fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  releaseChannelOutSchema,
  type Page,
  type ReleaseChannelCreate,
  type ReleaseChannelOut,
  type ReleaseChannelUpdate,
} from '@/lib/contracts'

const BASE = '/release-channels'

/** `GET /release-channels` — **PAGINADO**, ordenado por id (orden de creación). */
export function listReleaseChannels(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ReleaseChannelOut>> {
  return fetchPage(BASE, releaseChannelOutSchema, { query: params, signal })
}

/** `POST /release-channels` → 201. Pide `release_channels.write` + step-up. */
export function createReleaseChannel(body: ReleaseChannelCreate): Promise<ReleaseChannelOut> {
  return mutateData('POST', BASE, releaseChannelOutSchema, { body })
}

/**
 * `PATCH /release-channels/{id}` — parcial por presencia de clave. `slug` no existe en el body:
 * es inmutable. `environment_id: null` desvincula el entorno.
 */
export function updateReleaseChannel(
  id: number,
  body: ReleaseChannelUpdate,
): Promise<ReleaseChannelOut> {
  return mutateData('PATCH', `${BASE}/${id}`, releaseChannelOutSchema, { body })
}

/**
 * `DELETE /release-channels/{id}` — borra el canal con sus punteros y su historial.
 *
 * `confirmSlug` va como **query param** y solo hace falta si el canal tiene punteros: sin él el
 * backend responde 422 `release_channel.confirmation_required`.
 */
export function deleteReleaseChannel(
  id: number,
  confirmSlug?: string,
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`, { query: { confirm_slug: confirmSlug } })
}
