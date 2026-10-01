import { DESTRUCTIVE_CAPABILITIES, type CapabilityDescriptor } from '@/lib/contracts'

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
 * - las capacidades globales (`access_admin`, `security_officer`) no se recortan por alcance.
 *
 * Y una diferencia que hay que decir siempre que se muestre esto: **hoy el gateway aplica esa
 * restricción solo en cuatro rutas** (borrar una base, aprovisionar, aplicar y revertir
 * versiones). En el resto rige el rol unión —el más alto en cualquier alcance—. Ver
 * `SCOPE_ENFORCEMENT_NOTE`.
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

/** El más restrictivo de una lista no vacía de roles (el `min` de `effective_role_at`). */
export function mostRestrictiveRole(roles: readonly string[]): string {
  return roles.reduce((lowest, role) => (roleRank(role) < roleRank(lowest) ? role : lowest))
}

/** El más alto: el rol UNIÓN de la capa 1 (`union_role`). */
export function highestRole(roles: readonly string[]): string {
  return roles.reduce((highest, role) => (roleRank(role) > roleRank(highest) ? role : highest))
}

/**
 * Nota honesta sobre dónde se hace cumplir hoy la restricción por alcance. Toda vista que muestre
 * acceso por alcance la tiene que llevar: sin ella, la pantalla promete una restricción que en la
 * mayoría de las operaciones no existe todavía.
 */
export const SCOPE_ENFORCEMENT_NOTE =
  'Hoy el gateway aplica esta restricción por alcance en borrar bases, aprovisionar, aplicar y revertir versiones; en el resto de las operaciones rige el rol más alto que tenga en cualquier alcance. Se completa en una próxima versión.'

/**
 * Las capacidades que el backend HOY vuelve a exigir en el destino (capa 2), y por lo tanto las
 * únicas que un permiso por alcance de verdad recorta. Espejo de las llamadas a
 * `assert_scope_for_database` en `app/routes/v1/managed_databases.py`:
 *
 * - `DELETE /managed-databases/{id}` → `databases.drop` (con `drop_remote`) o `databases.write`;
 * - `POST /managed-databases/{id}/provision` → `databases.write`;
 * - `POST .../migrations/apply` y `.../migrations/rollback` → `blueprints.apply`.
 *
 * Ojo: `databases.write` se recorta solo en esas dos rutas; crear o editar una base todavía mira el
 * rol unión. Cuando `scope-enforcement-hardening` extienda la capa 2, esta lista crece con él.
 */
export const LAYER2_CAPABILITIES = [
  'databases.write',
  'databases.drop',
  'blueprints.apply',
] as const

/** ¿El backend hoy recorta esta capacidad por alcance? Ver `LAYER2_CAPABILITIES`. */
export function isEnforcedByScopeToday(id: string): boolean {
  return (LAYER2_CAPABILITIES as readonly string[]).includes(id)
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

/** ¿Borra o cambia algo en un motor real? Lista del frontend: el backend no publica la marca. */
export function isDestructive(capability: CapabilityDescriptor): boolean {
  return (DESTRUCTIVE_CAPABILITIES as readonly string[]).includes(capability.id)
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
 * 1. Sin ningún permiso por alcance → rol base, sin mirar el destino.
 * 2. Entorno del destino = el de la base, o el más protegido si no está clasificada.
 * 3. Aplican el permiso de ese entorno y el del servidor del destino.
 * 4. Ninguno → rol base (NUNCA el rol unión). Alguno → el más restrictivo.
 */
export function effectiveRoleAt(
  input: RoleResolutionInput,
  target: AccessTarget,
  environments: readonly EnvironmentRank[],
): string {
  if (input.grants.length === 0) return input.baseRole
  const environmentId = target.environmentId ?? mostProtectedEnvironmentId(environments)
  const applicable = input.grants
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
  return applicable.length === 0 ? input.baseRole : mostRestrictiveRole(applicable)
}

export interface AccessInput extends RoleResolutionInput {
  catalog: readonly CapabilityDescriptor[]
  globalCapabilities: readonly string[]
}

/** El rol unión de la capa 1: el máximo entre el base y todos los permisos por alcance. */
export function unionRole(input: RoleResolutionInput): string {
  return highestRole([input.baseRole, ...input.grants.map((grant) => grant.role)])
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
  return capabilitiesWithScopeRole(input, effectiveRoleAt(input, target, environments))
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
}

/**
 * El acceso efectivo completo, para la sección «Acceso efectivo» (administración) y «Mi acceso».
 *
 * Para cada permiso responde «¿qué tiene donde rige ese permiso solo?» y lo compara con el rol
 * base, que es lo que rige en todo lo demás. Los cruces entorno × servidor se listan aparte
 * porque ahí ninguno de los dos rige solo: gana el más restrictivo.
 */
export function resolveEffectiveAccess(input: AccessInput): EffectiveAccess {
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
  }
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
