import { API_TOKEN_DATA_SCOPES } from '@/lib/contracts'

/**
 * Reglas de UI de los scopes de DATOS de un token (`data.read`, `data.query`). Lógica pura: la
 * autoridad es el servidor (422 `ttl_too_long` si el backend fija un tope propio de vida, 403 de
 * step-up). La vida de estos tokens ya no se anticipa en la pantalla con un número fijo, porque el
 * tope propio es configurable (`MCP_DATA_TOKEN_MAX_TTL_DAYS`, por defecto sin tope) y no viaja al
 * cliente.
 */

/** Los scopes de datos de una lista, en el orden en que vienen. */
export function dataScopesOf(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => (API_TOKEN_DATA_SCOPES as readonly string[]).includes(scope))
}
