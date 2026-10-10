import {
  INTEGRATION_SCOPE_TIERS,
  isDestructiveIntegrationScope,
  type IntegrationCeilingOut,
  type IntegrationScopeCeilingEntry,
  type IntegrationScopeTier,
  type IntegrationTokenOut,
  type IntegrationTokenUpdate,
} from '@/lib/contracts'
import { INTEGRATION_TIER_TITLES } from './messages'

/** Un bloque del selector: los scopes del techo que comparten tier. */
export interface CeilingScopeGroup {
  tier: IntegrationScopeTier
  title: string
  entries: IntegrationScopeCeilingEntry[]
}

/**
 * Agrupa los scopes del techo por el `tier` que informó el servidor, en el orden Lectura →
 * Escritura → Destructivas. Un tier sin scopes en el techo NO produce grupo: quien no puede dar
 * scopes destructivos no ve ni el encabezado, porque revelaría que existen.
 */
export function groupCeilingScopesByTier(
  entries: readonly IntegrationScopeCeilingEntry[],
): CeilingScopeGroup[] {
  return INTEGRATION_SCOPE_TIERS.map((tier) => ({
    tier,
    title: INTEGRATION_TIER_TITLES[tier],
    entries: entries.filter((entry) => entry.tier === tier),
  })).filter((group) => group.entries.length > 0)
}

/** ¿La selección incluye algún scope destructivo del techo? Un scope fuera del techo no cuenta. */
export function hasDestructiveSelection(
  selectedScopes: readonly string[],
  ceilingEntries: readonly IntegrationScopeCeilingEntry[],
): boolean {
  return ceilingEntries.some(
    (entry) => entry.tier === 'destructive' && selectedScopes.includes(entry.scope),
  )
}

/**
 * Tope de vida (días) que aplica el servidor a la selección: el del tier MÁS estricto elegido.
 * Destructivo (7) manda sobre escritura (30), y esta sobre solo lectura (90).
 */
export function maxTtlDaysFor(
  selectedScopes: readonly string[],
  ceiling: IntegrationCeilingOut,
): number {
  const selectedEntries = ceiling.scopes.filter((entry) => selectedScopes.includes(entry.scope))
  if (selectedEntries.some((entry) => entry.tier === 'destructive')) {
    return ceiling.max_destructive_ttl_days
  }
  if (selectedEntries.some((entry) => entry.mutates)) {
    return ceiling.max_write_ttl_days
  }
  return ceiling.max_ttl_days
}

/**
 * ¿Los permisos EFECTIVOS del token incluyen uno destructivo? Usa el vocabulario conocido y no el
 * techo de quien mira: un `access.admin` ve tokens ajenos con scopes que su propio techo no ofrece.
 * Un scope solo suspendido no cuenta: hoy no puede hacer nada.
 */
export function tokenHasDestructiveScope(token: IntegrationTokenOut): boolean {
  return token.scopes.some(isDestructiveIntegrationScope)
}

function haveSameMembers<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length && first.every((item) => second.includes(item))
}

/** Lo que el formulario de edición tiene hoy, en el tipo de cada campo de la pantalla. */
export interface IntegrationTokenDraft {
  name: string
  scopes: string[]
  serverIds: number[]
  blueprintIds: number[]
  note: string
}

/**
 * Arma el `PATCH` con SOLO lo que cambió. Mandar lo igual no rompería nada, pero un `scopes`
 * idéntico es ruido: el servidor igual lo recorre y, si trae un scope de más, pide step-up.
 * `scopes` va siempre como lista completa: el servidor reemplaza, no suma.
 */
export function buildUpdateBody(
  token: IntegrationTokenOut,
  draft: IntegrationTokenDraft,
): IntegrationTokenUpdate {
  const body: IntegrationTokenUpdate = {}

  const trimmedName = draft.name.trim()
  if (trimmedName !== token.name) body.name = trimmedName

  if (!haveSameMembers(draft.scopes, token.scopes)) body.scopes = draft.scopes
  if (!haveSameMembers(draft.serverIds, token.server_ids)) body.server_ids = draft.serverIds
  if (!haveSameMembers(draft.blueprintIds, token.blueprint_ids)) {
    body.blueprint_ids = draft.blueprintIds
  }

  const trimmedNote = draft.note.trim()
  const previousNote = token.note ?? ''
  if (trimmedNote !== previousNote) body.note = trimmedNote

  return body
}
