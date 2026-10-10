import {
  API_TOKEN_BLUEPRINT_SQL_SCOPE,
  API_TOKEN_DATA_SCOPES,
  API_TOKEN_DEFINITIONS_SCOPE,
} from '@/lib/contracts'

/**
 * Reglas de UI de los scopes de DATOS de un token (`data.read`, `data.query`, `data.definitions`,
 * `data.blueprint_sql`). Lógica pura: la
 * autoridad es el servidor (422 `ttl_too_long` si el backend fija un tope propio de vida, 403 de
 * step-up). La vida de estos tokens ya no se anticipa en la pantalla con un número fijo, porque el
 * tope propio es configurable (`MCP_DATA_TOKEN_MAX_TTL_DAYS`, por defecto sin tope) y no viaja al
 * cliente.
 */

/** Los scopes de datos de una lista, en el orden en que vienen. */
export function dataScopesOf(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => (API_TOKEN_DATA_SCOPES as readonly string[]).includes(scope))
}

/**
 * Los scopes de datos que leen FILAS (`data.read`, `data.query`): todos menos los que leen código
 * o SQL de migraciones. Si se contaran aquí, el aviso de filas prometería una lectura que esos
 * scopes no hacen.
 */
export function rowScopesOf(scopes: readonly string[]): string[] {
  return dataScopesOf(scopes).filter(
    (scope) => scope !== API_TOKEN_DEFINITIONS_SCOPE && scope !== API_TOKEN_BLUEPRINT_SQL_SCOPE,
  )
}

/** ¿La lista incluye `data.definitions`, que lee el CÓDIGO de objetos de terceros? */
export function hasDefinitionsScope(scopes: readonly string[]): boolean {
  return scopes.includes(API_TOKEN_DEFINITIONS_SCOPE)
}

/** ¿La lista incluye `data.blueprint_sql`, que lee el SQL de las migraciones de un blueprint? */
export function hasBlueprintSqlScope(scopes: readonly string[]): boolean {
  return scopes.includes(API_TOKEN_BLUEPRINT_SQL_SCOPE)
}
