import { fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  apiTokenCreatedOutSchema,
  apiTokenOutSchema,
  type ApiTokenCreate,
  type ApiTokenCreatedOut,
  type ApiTokenOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/api-tokens'

/** `GET /api-tokens` — paginado (§3). */
export function listApiTokens(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ApiTokenOut>> {
  return fetchPage(BASE, apiTokenOutSchema, { query: params, signal })
}

/**
 * `POST /api-tokens` → 201. Límite de tasa 10/min. Devuelve el bearer completo UNA sola vez: si
 * la pantalla no lo entrega, el token queda emitido y es inservible.
 */
export function createApiToken(body: ApiTokenCreate): Promise<ApiTokenCreatedOut> {
  return mutateData('POST', BASE, apiTokenCreatedOutSchema, { body })
}

/**
 * `DELETE /api-tokens/{token_pk}` — devuelve la fila YA revocada, no un 204.
 *
 * ⚠️ `tokenPk` es el `id` (PK numérica), NO el `token_id` del bearer. Son campos distintos del
 * mismo objeto y confundirlos produce un 404 que parece «el token no existe».
 */
export function revokeApiToken(tokenPk: number): Promise<ApiTokenOut> {
  return mutateData('DELETE', `${BASE}/${tokenPk}`, apiTokenOutSchema, {})
}
