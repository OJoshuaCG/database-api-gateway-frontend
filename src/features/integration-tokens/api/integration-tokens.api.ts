import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  integrationCeilingOutSchema,
  integrationTokenCreatedOutSchema,
  integrationTokenOutSchema,
  type IntegrationCeilingOut,
  type IntegrationTokenCreate,
  type IntegrationTokenCreatedOut,
  type IntegrationTokenOut,
  type IntegrationTokenUpdate,
  type Page,
} from '@/lib/contracts'

const BASE = '/integration-tokens'

/** `GET /integration-tokens` — paginado. El servidor filtra por dueño (y `total` también). */
export function listIntegrationTokens(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<IntegrationTokenOut>> {
  return fetchPage(BASE, integrationTokenOutSchema, { query: params, signal })
}

/**
 * `GET /integration-tokens/ceiling` — los scopes que el usuario puede dar HOY (los que no tiene no
 * vienen), con su tier, los topes de vida por tier y el estado del kill switch.
 */
export function getIntegrationCeiling(signal?: AbortSignal): Promise<IntegrationCeilingOut> {
  return fetchData(`${BASE}/ceiling`, integrationCeilingOutSchema, { signal })
}

/**
 * `POST /integration-tokens` → 201. Límite de tasa 10/min y step-up (lo resuelve `client.ts`).
 * Devuelve el bearer completo UNA sola vez.
 */
export function createIntegrationToken(
  body: IntegrationTokenCreate,
): Promise<IntegrationTokenCreatedOut> {
  return mutateData('POST', BASE, integrationTokenCreatedOutSchema, { body })
}

/**
 * `PATCH /integration-tokens/{token_pk}` — reemplaza los campos enviados de un token vivo propio;
 * el bearer no cambia. Agregar un scope de escritura o destructivo pide step-up.
 *
 * ⚠️ `tokenPk` es el `id` (PK numérica), NO el `token_id` del bearer.
 */
export function updateIntegrationToken(
  tokenPk: number,
  body: IntegrationTokenUpdate,
): Promise<IntegrationTokenOut> {
  return mutateData('PATCH', `${BASE}/${tokenPk}`, integrationTokenOutSchema, { body })
}

/**
 * `DELETE /integration-tokens/{token_pk}` — devuelve la fila YA revocada, no un 204. Funciona con
 * el kill switch apagado. ⚠️ `tokenPk` es el `id`, no el `token_id`.
 */
export function revokeIntegrationToken(tokenPk: number): Promise<IntegrationTokenOut> {
  return mutateData('DELETE', `${BASE}/${tokenPk}`, integrationTokenOutSchema, {})
}
