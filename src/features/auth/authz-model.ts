import {
  DESTRUCTIVE_CAPABILITIES,
  type CapabilityDescriptor,
  type EffectiveAccess as ServerEffectiveAccess,
} from '@/lib/contracts'

/**
 * Modelo de autorización del gateway, en funciones puras: qué otorga cada rol y qué acceso tiene
 * una persona en cada alcance.
 *
 * **Todo se deriva del catálogo** (`GET /authz/catalog`): qué capacidades tiene un rol o una
 * capacidad global sale de las columnas `roles` y `global_capabilities` de cada fila, nunca de una
 * lista escrita acá. Si el backend mueve una capacidad de rol, esta pantalla lo refleja sin
 * desplegar la SPA.
 *
 * **La resolución por alcance es un ESPEJO de `app/core/scope.py`** del backend, regla por regla:
 *
 * - en un destino, aplican el permiso del entorno del destino y el del servidor del destino;
 * - si aplica alguno, rige el MÁS RESTRICTIVO de ellos (no se suma al rol base: lo reemplaza);
 * - si no aplica ninguno, rige el rol BASE — nunca el rol unión;
 * - una base sin entorno (o un destino desconocido) cuenta como el entorno MÁS PROTEGIDO;
 * - las capacidades globales (`access_admin`, `security_officer`) no se recortan por alcance;
 * - las capacidades PUNTUALES (`app/core/capability_resolution.py`) SUMAN al rol: en la capa 1
 *   entran por unión (con su lectura implícita) y en la capa 2 solo valen en los destinos de su
 *   alcance. Ver `expandGrant`, `grantMatches` y `explainAccess`.
 *
 * Y una diferencia que hay que decir siempre que se muestre esto: **el gateway aplica esa
 * restricción en toda operación sobre una base o un servidor concreto** (capa 2: las capacidades
 * por alcance que el rol `viewer` no tiene). Las lecturas y las capacidades globales NO se recortan
 * por alcance: ahí rige el rol unión. Ver `SCOPE_ENFORCEMENT_NOTE` e `isEnforcedByScope`.
 */

/** Cadena monotónica de roles: cada uno incluye al anterior (`_ROLE_RANK` del backend). */
export const ROLE_CHAIN = ['viewer', 'operator', 'owner'] as const

/**
 * Rango de un rol. Un rol que esta versión no conoce vale `-1`: el backend le da el conjunto
 * VACÍO (`role_capabilities` falla cerrado), así que acá es el más restrictivo posible.
 */
export function roleRank(role: string): number {
  return (ROLE_CHAIN as readonly string[]).indexOf(role)
}

/** Tipos de alcance que el backend reconoce (`get_current_actor` descarta cualquier otro). */
export const SCOPE_TYPES_KNOWN = ['environment', 'server'] as const

/** ¿Es un rol de la cadena? */
export function isKnownRole(role: string): boolean {
  return roleRank(role) >= 0
}

/**
 * Rol base tal como lo lee el backend: uno desconocido cae a `viewer` (`get_current_actor`:
 * `GatewayRole(ctx["role"])` con `except ValueError: base = VIEWER`), nunca a «sin rol».
 */
export function normalizeBaseRole(role: string): string {
  return isKnownRole(role) ? role : 'viewer'
}

/**
 * Los permisos que el backend de verdad carga: descarta los de un tipo de alcance o un rol que no
 * conoce, igual que `get_current_actor` (no los degrada a otro tipo ni a otro rol).
 */
export function knownGrants<T extends ScopeGrant>(grants: readonly T[]): T[] {
  return grants.filter(
    (grant) =>
      (SCOPE_TYPES_KNOWN as readonly string[]).includes(grant.scopeType) && isKnownRole(grant.role),
  )
}

/** El más restrictivo de una lista no vacía de roles (el `min` de `effective_role_at`). */
export function mostRestrictiveRole(roles: readonly string[]): string {
  return roles.reduce((lowest, role) => (roleRank(role) < roleRank(lowest) ? role : lowest))
}

/** El más alto: el rol UNIÓN de la capa 1 (`union_role`). */
export function highestRole(roles: readonly string[]): string {
  return roles.reduce((highest, role) => (roleRank(role) > roleRank(highest) ? role : highest))
}

/**
 * Nota honesta sobre dónde se hace cumplir la restricción por alcance. Toda vista que muestre
 * acceso por alcance la tiene que llevar: sin ella, la pantalla promete un recorte que las
 * lecturas y las capacidades globales no tienen.
 */
export const SCOPE_ENFORCEMENT_NOTE =
  'El gateway aplica esta restricción por alcance en toda operación que escribe, ejecuta o descarga sobre una base o un servidor concreto. Las lecturas y las capacidades globales (administración, política) no se recortan por alcance: ahí rige el rol más alto que tenga en cualquier alcance.'

/**
 * F-17 (`server_resolution_inventory_only` de scope-readiness): el entorno de un servidor se
 * resuelve solo con las bases inventariadas. Va escrito donde se otorgan permisos por alcance.
 */
export const SERVER_RESOLUTION_INVENTORY_NOTE =
  'Las bases que el gateway no tiene inventariadas no cuentan para resolver el entorno de un servidor.'

/**
 * Las capacidades que el backend vuelve a exigir en el destino (capa 2): **las de eje por alcance
 * que el rol `viewer` no tiene**. Se derivan del catálogo y no de una lista: cada ruta con destino
 * declara `require_at` y el viewer es el piso que rige sin permisos por alcance, así que lo único
 * que un permiso por alcance puede recortar son las capacidades por encima de ese piso.
 */
export function layer2CapabilityIds(catalog: readonly CapabilityDescriptor[]): string[] {
  return catalog
    .filter((row) => row.scope_axis !== 'global' && !row.roles.includes('viewer'))
    .map((row) => row.id)
}

/** ¿Esta capacidad se recorta por alcance? Ver `layer2CapabilityIds`. */
export function isEnforcedByScope(id: string, catalog: readonly CapabilityDescriptor[]): boolean {
  return layer2CapabilityIds(catalog).includes(id)
}

// ── Derivación desde el catálogo ───────────────────────────────────────────────

/** Capacidades que otorga un rol, en el orden del catálogo. */
export function roleCapabilityIds(
  catalog: readonly CapabilityDescriptor[],
  role: string,
): string[] {
  return catalog.filter((row) => row.roles.includes(role)).map((row) => row.id)
}

/** Capacidades que otorga una capacidad global (`access_admin`, `security_officer`). */
export function globalCapabilityIds(
  catalog: readonly CapabilityDescriptor[],
  globalCapability: string,
): string[] {
  return catalog
    .filter((row) => row.global_capabilities.includes(globalCapability))
    .map((row) => row.id)
}

/** Roles que el catálogo menciona, en el orden de la cadena (y los desconocidos al final). */
export function catalogRoles(catalog: readonly CapabilityDescriptor[]): string[] {
  const seen = new Set(catalog.flatMap((row) => row.roles))
  const known = ROLE_CHAIN.filter((role) => seen.has(role))
  const unknown = [...seen].filter((role) => roleRank(role) < 0).sort()
  return [...known, ...unknown]
}

/** Capacidades globales que el catálogo menciona, ordenadas. */
export function catalogGlobalCapabilities(catalog: readonly CapabilityDescriptor[]): string[] {
  return [...new Set(catalog.flatMap((row) => row.global_capabilities))].sort()
}

/**
 * ¿Borra o cambia algo en un motor real? Decide la marca `destructive` del catálogo; solo cuando
 * el backend no la publica (`null`) se cae a la lista del frontend.
 */
export function isDestructive(capability: CapabilityDescriptor): boolean {
  return (
    capability.destructive ??
    (DESTRUCTIVE_CAPABILITIES as readonly string[]).includes(capability.id)
  )
}

/** ¿El alcance la puede recortar? Las de eje `global` no tienen destino: rigen en todo el gateway. */
export function isScopedCapability(capability: CapabilityDescriptor): boolean {
  return capability.scope_axis !== 'global'
}

// ── Diferencias ────────────────────────────────────────────────────────────────

export interface CapabilityDiff {
  /** Están en `to` y no en `from`. */
  gained: string[]
  /** Están en `from` y no en `to`. */
  lost: string[]
}

/** Qué cambia de `from` a `to`. Conserva el orden de entrada de cada lado. */
export function diffCapabilities(from: Iterable<string>, to: Iterable<string>): CapabilityDiff {
  const fromList = [...from]
  const toList = [...to]
  const fromSet = new Set(fromList)
  const toSet = new Set(toList)
  return {
    gained: toList.filter((id) => !fromSet.has(id)),
    lost: fromList.filter((id) => !toSet.has(id)),
  }
}

/**
 * Ordena para mostrar: primero las destructivas, después las que divulgan, después el resto, y
 * dentro de cada grupo el orden del catálogo. Es el orden en que alguien decide: lo que no se
 * deshace va arriba.
 */
export function sortByRisk(
  ids: readonly string[],
  catalog: readonly CapabilityDescriptor[],
): CapabilityDescriptor[] {
  const position = new Map(catalog.map((row, index) => [row.id, index]))
  const byId = new Map(catalog.map((row) => [row.id, row]))
  const weight = (row: CapabilityDescriptor) => (isDestructive(row) ? 0 : row.discloses ? 1 : 2)
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is CapabilityDescriptor => row !== undefined)
    .sort((a, b) => weight(a) - weight(b) || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
}

// ── Resolución por destino (espejo de `effective_role_at`) ─────────────────────

/** Un permiso por alcance, con el vocabulario de `scope_roles` / `scope_grants`. */
export interface ScopeGrant {
  scopeType: string
  scopeId: number
  role: string
}

/** Un entorno, con lo único que la resolución necesita: su rango y su id (desempate). */
export interface EnvironmentRank {
  id: number
  rank: number
}

/**
 * Un destino concreto. `environmentId` es el entorno YA resuelto de la base: `null` = sin
 * clasificar, y se trata como el más protegido. Un destino a nivel servidor (sin base) pasa el
 * entorno que el backend le derivaría (`derived_environment_slug` de scope-readiness) o `null`.
 */
export interface AccessTarget {
  serverId: number | null
  environmentId: number | null
}

/**
 * El entorno de rango máximo, con desempate por id mayor — el orden `(rank, id)` de
 * `most_protected_environment_id`. `null` solo si no hay entornos.
 */
export function mostProtectedEnvironmentId(
  environments: readonly EnvironmentRank[],
): number | null {
  let best: EnvironmentRank | null = null
  for (const env of environments) {
    if (!best || env.rank > best.rank || (env.rank === best.rank && env.id > best.id)) best = env
  }
  return best?.id ?? null
}

export interface RoleResolutionInput {
  /** Rol base. Si el backend no lo publica, el que haya (como hace `actor.base_role or role`). */
  baseRole: string
  grants: readonly ScopeGrant[]
}

/**
 * El rol en ESTE destino. Regla por regla igual que `effective_role_at`:
 *
 * 0. Permisos de tipo o rol desconocido no existen (los descarta `get_current_actor`), y un rol
 *    base desconocido es `viewer`.
 * 1. Sin ningún permiso por alcance → rol base, sin mirar el destino.
 * 2. Sin servidor NI entorno es una operación global → rol base (`resolve_environment_id`
 *    devuelve `None` y no se inventa el más protegido).
 * 3. Entorno del destino = el de la base, o el más protegido si no está clasificada.
 * 4. Aplican el permiso de ese entorno y el del servidor del destino.
 * 5. Ninguno → rol base (NUNCA el rol unión). Alguno → el más restrictivo.
 */
export function effectiveRoleAt(
  input: RoleResolutionInput,
  target: AccessTarget,
  environments: readonly EnvironmentRank[],
): string {
  const baseRole = normalizeBaseRole(input.baseRole)
  const grants = knownGrants(input.grants)
  if (grants.length === 0) return baseRole
  if (target.serverId === null && target.environmentId === null) return baseRole
  const environmentId = target.environmentId ?? mostProtectedEnvironmentId(environments)
  const applicable = grants
    .filter(
      (grant) =>
        (grant.scopeType === 'environment' &&
          environmentId !== null &&
          grant.scopeId === environmentId) ||
        (grant.scopeType === 'server' &&
          target.serverId !== null &&
          grant.scopeId === target.serverId),
    )
    .map((grant) => grant.role)
  return applicable.length === 0 ? baseRole : mostRestrictiveRole(applicable)
}

export interface AccessInput extends RoleResolutionInput {
  catalog: readonly CapabilityDescriptor[]
  globalCapabilities: readonly string[]
  /** Capacidades puntuales de la persona. Omitido = ninguna. */
  capabilityGrants?: readonly CapabilityGrantInput[]
}

/** El rol unión de la capa 1: el máximo entre el base y todos los permisos por alcance. */
export function unionRole(input: RoleResolutionInput): string {
  return highestRole([
    normalizeBaseRole(input.baseRole),
    ...knownGrants(input.grants).map((grant) => grant.role),
  ])
}

/** Lo que suman las capacidades globales. Nunca se recortan por alcance. */
function globalsGrant(input: AccessInput): Set<string> {
  return new Set(
    input.globalCapabilities.flatMap((global) => globalCapabilityIds(input.catalog, global)),
  )
}

/**
 * Capacidades de eje `global` que rigen en todo el gateway: las del rol UNIÓN más las globales.
 * Un permiso por alcance no las recorta porque no tienen destino que recortar.
 */
export function globalAxisCapabilities(input: AccessInput): string[] {
  const union = new Set(roleCapabilityIds(input.catalog, unionRole(input)))
  const globals = globalsGrant(input)
  return input.catalog
    .filter((row) => !isScopedCapability(row) && (union.has(row.id) || globals.has(row.id)))
    .map((row) => row.id)
}

/**
 * Capacidades con `role` como rol del alcance: las POR ALCANCE de ese rol, más las de eje global
 * (unión + globales), más las globales. En el orden del catálogo.
 */
export function capabilitiesWithScopeRole(input: AccessInput, role: string): string[] {
  const scoped = new Set(roleCapabilityIds(input.catalog, role))
  const globalAxis = new Set(globalAxisCapabilities(input))
  const globals = globalsGrant(input)
  return input.catalog
    .filter((row) =>
      isScopedCapability(row) ? scoped.has(row.id) || globals.has(row.id) : globalAxis.has(row.id),
    )
    .map((row) => row.id)
}

/** Capacidades en un destino concreto. Lo que usa la guarda de UI con `scope`. */
export function capabilitiesAt(
  input: AccessInput,
  target: AccessTarget,
  environments: readonly EnvironmentRank[],
): string[] {
  const fromRole = capabilitiesWithScopeRole(input, effectiveRoleAt(input, target, environments))
  // Las puntuales SUMAN al rol del destino (`_permits`: rol ∪ globales ∪ puntuales en el punto).
  const fromGrants = effectiveCapabilityGrants(input)
    .filter((grant) => grantMatches(grant, target, environments))
    .flatMap((grant) => expandGrant(grant.capability, input.catalog))
  if (fromGrants.length === 0) return fromRole
  const all = new Set([...fromRole, ...fromGrants])
  return input.catalog.filter((row) => all.has(row.id)).map((row) => row.id)
}

/** Una fila del acceso efectivo de un permiso por alcance. */
export interface GrantAccess {
  grant: ScopeGrant
  /** Capacidades donde rige SOLO este permiso. */
  capabilities: string[]
  /** Respecto del rol base. */
  diff: CapabilityDiff
}

/** Un cruce entre un permiso de entorno y uno de servidor: ahí rige el más restrictivo. */
export interface GrantOverlap {
  environmentGrant: ScopeGrant
  serverGrant: ScopeGrant
  role: string
}

export interface EffectiveAccess {
  baseRole: string
  /** Rol de la capa 1 (`/auth/me.role`). */
  unionRole: string
  /** Donde no aplica ningún permiso propio. */
  baseCapabilities: string[]
  grants: GrantAccess[]
  overlaps: GrantOverlap[]
  /** Por capacidad global, qué suma. */
  globals: { id: string; capabilities: string[] }[]
  /** Capacidades de eje global: iguales en todos los alcances. */
  globalAxis: string[]
  /** Capacidades puntuales activas (y las inertes, marcadas), con lo que traen implícito. */
  capabilityGrants: CapabilityGrantAccess[]
}

/**
 * El acceso efectivo completo, para la sección «Acceso efectivo» (administración) y «Mi acceso».
 *
 * Para cada permiso responde «¿qué tiene donde rige ese permiso solo?» y lo compara con el rol
 * base, que es lo que rige en todo lo demás. Los cruces entorno × servidor se listan aparte
 * porque ahí ninguno de los dos rige solo: gana el más restrictivo.
 */
export function resolveEffectiveAccess(rawInput: AccessInput): EffectiveAccess {
  // Lo mismo que carga el backend: sin permisos desconocidos y con el base normalizado.
  const input: AccessInput = {
    ...rawInput,
    baseRole: normalizeBaseRole(rawInput.baseRole),
    grants: knownGrants(rawInput.grants),
  }
  const baseCapabilities = capabilitiesWithScopeRole(input, input.baseRole)
  const grants = input.grants.map((grant) => {
    const capabilities = capabilitiesWithScopeRole(input, grant.role)
    return { grant, capabilities, diff: diffCapabilities(baseCapabilities, capabilities) }
  })
  const environmentGrants = input.grants.filter((grant) => grant.scopeType === 'environment')
  const serverGrants = input.grants.filter((grant) => grant.scopeType === 'server')
  const overlaps = environmentGrants.flatMap((environmentGrant) =>
    serverGrants.map((serverGrant) => ({
      environmentGrant,
      serverGrant,
      role: mostRestrictiveRole([environmentGrant.role, serverGrant.role]),
    })),
  )
  return {
    baseRole: input.baseRole,
    unionRole: unionRole(input),
    baseCapabilities,
    grants,
    overlaps,
    globals: input.globalCapabilities.map((id) => ({
      id,
      capabilities: globalCapabilityIds(input.catalog, id),
    })),
    globalAxis: globalAxisCapabilities(input),
    capabilityGrants: knownCapabilityGrants(input).map((grant) => {
      const capabilities = expandGrant(grant.capability, input.catalog)
      return { grant, capabilities, implied: capabilities.filter((id) => id !== grant.capability) }
    }),
  }
}

// ── Capacidades puntuales (espejo de `app/core/capability_resolution.py`) ──────

/** Una capacidad puntual, con el vocabulario de `capability_grants` / `/auth/me`. */
export interface CapabilityGrantInput {
  capability: string
  /** `environment` | `server`. Otro tipo se descarta, como en `parse_capability_grants`. */
  scopeType: string
  scopeId: number
  /** Solo `active` concede algo: una `pending` no. Omitido = activa. */
  status?: string
  /** Id en el servidor, para atribuir la procedencia. */
  grantId?: number | null
  /** Nombre del destino ya resuelto por quien llama («Producción», «db-prod-01»). */
  targetLabel?: string
  /** Retenida pero sin efecto (persona desactivada): se lista, no cuenta. */
  inert?: boolean
}

/** Lo que una capacidad puntual aporta: ella más las lecturas que trae implícitas. */
export interface CapabilityGrantAccess {
  grant: CapabilityGrantInput
  capabilities: string[]
  /** Solo las lecturas implícitas (sin la capacidad otorgada). */
  implied: string[]
}

/**
 * La capacidad más la lectura que trae implícita (`expand` del backend). Las lecturas salen de la
 * columna `implies` del catálogo y no de una lista local; sin ella (backend anterior), solo la propia.
 */
export function expandGrant(
  capability: string,
  catalog: readonly CapabilityDescriptor[],
): string[] {
  const implied = catalog.find((row) => row.id === capability)?.implies ?? []
  return [capability, ...implied.filter((id) => id !== capability)]
}

/**
 * Lo que el backend carga de verdad (`parse_capability_grants`, fail-closed en el lector): solo las
 * `active`, de una capacidad que el catálogo marca otorgable —una desconocida o global no acuña
 * nada—, con alcance de entorno o servidor e id positivo. Las inertes se conservan, marcadas.
 */
export function knownCapabilityGrants(input: {
  catalog: readonly CapabilityDescriptor[]
  capabilityGrants?: readonly CapabilityGrantInput[]
}): CapabilityGrantInput[] {
  return (input.capabilityGrants ?? []).filter(
    (grant) =>
      (grant.status ?? 'active') === 'active' &&
      (SCOPE_TYPES_KNOWN as readonly string[]).includes(grant.scopeType) &&
      Number.isInteger(grant.scopeId) &&
      grant.scopeId > 0 &&
      input.catalog.some((row) => row.id === grant.capability && row.grantable),
  )
}

/** Las que además tienen efecto: sin las inertes de una persona desactivada. */
export function effectiveCapabilityGrants(input: {
  catalog: readonly CapabilityDescriptor[]
  capabilityGrants?: readonly CapabilityGrantInput[]
}): CapabilityGrantInput[] {
  return knownCapabilityGrants(input).filter((grant) => !grant.inert)
}

/**
 * ¿La capacidad puntual vale en este destino? (`grants_allow`): por entorno si es el del destino
 * (el más protegido si la base no está clasificada), por servidor si es el del destino. Un destino
 * global —sin servidor ni entorno— no coincide con ninguna.
 */
export function grantMatches(
  grant: CapabilityGrantInput,
  target: AccessTarget,
  environments: readonly EnvironmentRank[],
): boolean {
  if (target.serverId === null && target.environmentId === null) return false
  const environmentId = target.environmentId ?? mostProtectedEnvironmentId(environments)
  return (
    (grant.scopeType === 'environment' &&
      environmentId !== null &&
      grant.scopeId === environmentId) ||
    (grant.scopeType === 'server' && target.serverId !== null && grant.scopeId === target.serverId)
  )
}

/**
 * Capa 1: lo que la persona podría hacer en ALGÚN alcance. El rol unión, las globales y toda
 * capacidad puntual con su lectura implícita (`layer1_capabilities`). En el orden del catálogo.
 */
export function layer1Capabilities(input: AccessInput): string[] {
  const all = new Set([
    ...roleCapabilityIds(input.catalog, unionRole(input)),
    ...globalsGrant(input),
    ...effectiveCapabilityGrants(input).flatMap((grant) =>
      expandGrant(grant.capability, input.catalog),
    ),
  ])
  return input.catalog.filter((row) => all.has(row.id)).map((row) => row.id)
}

// ── Procedencia (espejo de `explain`) ──────────────────────────────────────────

/** De dónde sale una capacidad efectiva. Los mismos valores que `source` del servidor. */
export const PROVENANCE_SOURCES = ['role', 'scoped_role', 'global', 'capability_grant'] as const

/** Una capacidad efectiva y su fuente. Una capacidad con varias fuentes repite filas. */
export interface ProvenanceEntry {
  capability: string
  /** Uno de `PROVENANCE_SOURCES`; un valor nuevo del backend se conserva como viene. */
  source: string
  scopeType: string | null
  scopeId: number | null
  grantId: number | null
  /** Capacidad puntual que la trae implícita (lectura implícita). */
  impliedBy: string | null
  inert: boolean
}

const PROVENANCE_LABELS: Record<string, string> = {
  role: 'Por rol',
  scoped_role: 'Rol por alcance',
  global: 'Global',
  capability_grant: 'Capacidad puntual',
}

/** Etiqueta de la fuente: «Por rol», «Rol por alcance», «Global», «Capacidad puntual». */
export function provenanceLabel(source: string): string {
  return PROVENANCE_LABELS[source] ?? source
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * La procedencia calculada en el navegador, fila por fila igual que `explain` del backend (mismo
 * orden y mismas fuentes). Sirve para la VISTA PREVIA de lo que todavía no se guardó; lo que rige
 * hoy lo dice el servidor (`provenanceFromServer`).
 *
 * Invariante (la prueba un test, como en el backend): las capacidades de las filas no inertes son
 * exactamente `layer1Capabilities`.
 */
export function explainAccess(rawInput: AccessInput): ProvenanceEntry[] {
  const input: AccessInput = {
    ...rawInput,
    baseRole: normalizeBaseRole(rawInput.baseRole),
    grants: knownGrants(rawInput.grants),
  }
  const entry = (
    capability: string,
    source: string,
    extra: Partial<ProvenanceEntry> = {},
  ): ProvenanceEntry => ({
    capability,
    source,
    scopeType: null,
    scopeId: null,
    grantId: null,
    impliedBy: null,
    inert: false,
    ...extra,
  })
  const entries: ProvenanceEntry[] = []

  for (const id of [...roleCapabilityIds(input.catalog, input.baseRole)].sort(byText)) {
    entries.push(entry(id, 'role'))
  }
  const scoped = [...input.grants].sort(
    (a, b) => byText(a.scopeType, b.scopeType) || a.scopeId - b.scopeId,
  )
  for (const grant of scoped) {
    for (const id of [...roleCapabilityIds(input.catalog, grant.role)].sort(byText)) {
      entries.push(entry(id, 'scoped_role', { scopeType: grant.scopeType, scopeId: grant.scopeId }))
    }
  }
  for (const name of [...input.globalCapabilities].sort(byText)) {
    for (const id of [...globalCapabilityIds(input.catalog, name)].sort(byText)) {
      entries.push(entry(id, 'global'))
    }
  }
  for (const grant of knownCapabilityGrants(input)) {
    for (const id of [...expandGrant(grant.capability, input.catalog)].sort(byText)) {
      entries.push(
        entry(id, 'capability_grant', {
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
          grantId: grant.grantId ?? null,
          impliedBy: id === grant.capability ? null : grant.capability,
          inert: grant.inert ?? false,
        }),
      )
    }
  }
  return entries
}

/** `GET /gateway-users/{id}/effective-access` → filas de procedencia (camelCase, sin `null`s sueltos). */
export function provenanceFromServer(access: ServerEffectiveAccess): ProvenanceEntry[] {
  return access.capabilities.map((row) => ({
    capability: row.capability,
    source: row.source,
    scopeType: row.scope_type ?? null,
    scopeId: row.scope_id ?? null,
    grantId: row.grant_id ?? null,
    impliedBy: row.implied_by ?? null,
    inert: row.inert,
  }))
}

/**
 * Las capacidades puntuales de la respuesta del servidor, para alimentar la vista previa: una por
 * `grant_id`, sin las lecturas implícitas (esas las vuelve a derivar `expandGrant`).
 */
export function capabilityGrantsFromServer(access: ServerEffectiveAccess): CapabilityGrantInput[] {
  return access.capabilities
    .filter(
      (row) => row.source === 'capability_grant' && row.grant_id != null && row.implied_by == null,
    )
    .map((row) => ({
      capability: row.capability,
      scopeType: row.scope_type ?? '',
      scopeId: row.scope_id ?? 0,
      status: 'active',
      grantId: row.grant_id,
      targetLabel: row.scope_name ?? undefined,
      inert: row.inert,
    }))
}

/** Las capacidades de UNA fuente (y un alcance o una puntual), listas para pintar una fila. */
export interface ProvenanceGroup {
  kind: string
  key: string
  scopeType: string | null
  scopeId: number | null
  grantId: number | null
  /** La capacidad otorgada, solo en `capability_grant`. */
  grantCapability: string | null
  /** Ids en el orden del catálogo. */
  capabilities: string[]
  /** Capacidad → la puntual que la trae implícita. */
  impliedBy: Record<string, string>
  inert: boolean
}

/**
 * Agrupa las filas por fuente: el rol base, cada rol por alcance, las globales y cada capacidad
 * puntual (con sus lecturas implícitas dentro de la misma). Sirve igual para lo que dice el
 * servidor y para la vista previa, que es lo que mantiene a las dos pantallas leyéndose igual.
 */
export function groupProvenance(
  entries: readonly ProvenanceEntry[],
  catalog: readonly CapabilityDescriptor[],
): ProvenanceGroup[] {
  const groups = new Map<string, ProvenanceGroup>()
  for (const row of entries) {
    const grantRoot = row.impliedBy ?? row.capability
    const key =
      row.source === 'role'
        ? 'role'
        : row.source === 'scoped_role'
          ? `scoped:${row.scopeType}:${row.scopeId}`
          : row.source === 'global'
            ? 'global'
            : `grant:${row.grantId ?? `${grantRoot}@${row.scopeType}:${row.scopeId}`}`
    let group = groups.get(key)
    if (!group) {
      group = {
        kind: row.source,
        key,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        grantId: row.grantId,
        grantCapability: row.source === 'capability_grant' ? grantRoot : null,
        capabilities: [],
        impliedBy: {},
        inert: row.inert,
      }
      groups.set(key, group)
    }
    if (!group.capabilities.includes(row.capability)) group.capabilities.push(row.capability)
    if (row.impliedBy) group.impliedBy[row.capability] = row.impliedBy
  }
  const position = new Map(catalog.map((row, index) => [row.id, index]))
  const rank = (kind: string) => {
    const index = (PROVENANCE_SOURCES as readonly string[]).indexOf(kind)
    return index < 0 ? PROVENANCE_SOURCES.length : index
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      capabilities: [...group.capabilities].sort(
        (a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0),
      ),
    }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

// ── Copy ───────────────────────────────────────────────────────────────────────

/**
 * «a, b, c y 4 más» / «a, b y c». Para nombrar capacidades sin volcar una lista de 17 en una
 * línea: las primeras `max` dicen de qué se trata, el contador dice cuánto falta.
 */
export function summarizeLabels(labels: readonly string[], max = 3): string {
  if (labels.length === 0) return ''
  if (labels.length <= max) {
    return labels.length === 1
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} y ${labels.slice(-1).join('')}`
  }
  return `${labels.slice(0, max).join(', ')} y ${labels.length - max} más`
}

/**
 * «a», «a ni b», «a, b ni c»: la enumeración NEGATIVA de un aviso de acceso («Podés ver, pero no
 * aplicar, revertir ni marcar versiones»). Vacío con una lista vacía.
 */
export function joinWithNi(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} ni ${parts[parts.length - 1]}`
}

/**
 * Para qué sirve cada rol y cada capacidad global, en una línea. **Es el único lugar** con esta
 * prosa: la usan la matriz de roles, el modal de accesos y «Mi acceso». No reemplaza al catálogo
 * —qué otorga cada uno sale siempre de `GET /authz/catalog`—, solo dice la intención, que el
 * catálogo no publica. Si el backend cambia qué otorga un rol, revisá que la frase siga siendo
 * cierta (`capability_catalog.py`, `ROLE_CAPABILITIES` y `GLOBAL_CAPABILITIES`).
 */
export const ROLE_PURPOSES: Record<string, string> = {
  viewer: 'Consulta sin cambiar nada',
  operator: 'Crea y edita sin borrar ni ejecutar cambios de esquema',
  owner: 'Opera todo en su alcance, incluido lo destructivo',
  access_admin: 'Administra usuarios y accesos',
  security_officer: 'Administra servidores, catálogos y política',
}

/** Nombre legible de cada capacidad global; el id va aparte, en monoespaciada. */
export const GLOBAL_CAPABILITY_LABELS: Record<string, string> = {
  access_admin: 'Administración de accesos',
  security_officer: 'Oficial de seguridad',
}

export function globalCapabilityLabel(id: string): string {
  return GLOBAL_CAPABILITY_LABELS[id] ?? id
}

/**
 * Qué parte de lo que un permiso QUITA se recorta de verdad por alcance, para decirlo junto a
 * «Pierde N»: las lecturas y las globales no tienen destino, así que no se recortan.
 *
 * Devuelve el sufijo (con espacio inicial) o `''` si todo lo perdido se aplica por alcance.
 */
export function lostEnforcementNote(
  lost: readonly string[],
  labels: (ids: readonly string[]) => string[],
  catalog: readonly CapabilityDescriptor[],
): string {
  const enforced = lost.filter((id) => isEnforcedByScope(id, catalog))
  if (enforced.length === lost.length) return ''
  if (enforced.length === 0) return ' (no se recorta por alcance)'
  return ` (por alcance solo se recortan: ${summarizeLabels(labels(enforced))}; el resto no)`
}

/**
 * `id` de la fila de un permiso en `EffectiveAccessPanel`, dado su `idPrefix`: para enlazar desde
 * otra parte de la pantalla («Ver el efecto abajo»).
 */
export function effectiveAccessRowId(prefix: string, scopeType: string, scopeId: number): string {
  return `${prefix}-${scopeType}-${scopeId}`
}

/** Nombre visible de cada módulo del catálogo. Uno desconocido se muestra con su clave. */
export const MODULE_LABELS: Record<string, string> = {
  self: 'Cuenta propia',
  servers: 'Servidores',
  engine_users: 'Usuarios del motor',
  databases: 'Bases',
  blueprints: 'Blueprints',
  schema_diff: 'Comparación de esquemas',
  clones: 'Clones',
  collation: 'Collation',
  exports: 'Exportaciones',
  sql_console: 'Consola SQL',
  catalogs: 'Catálogos',
  environments: 'Entornos',
  gateway: 'Administración del gateway',
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module
}

/** Agrupa por módulo conservando el orden del catálogo (el de la primera aparición). */
export function groupByModule(
  rows: readonly CapabilityDescriptor[],
): { module: string; label: string; rows: CapabilityDescriptor[] }[] {
  const groups = new Map<string, CapabilityDescriptor[]>()
  for (const row of rows) {
    const group = groups.get(row.module)
    if (group) group.push(row)
    else groups.set(row.module, [row])
  }
  return [...groups].map(([module, grouped]) => ({
    module,
    label: moduleLabel(module),
    rows: grouped,
  }))
}

/** Nombre visible del eje de alcance de una capacidad. */
export function scopeAxisLabel(axis: string | null | undefined): string {
  switch (axis) {
    case 'global':
      return 'Global'
    case 'server':
      return 'Por servidor'
    case 'environment':
      return 'Por entorno'
    default:
      return axis ?? '—'
  }
}
