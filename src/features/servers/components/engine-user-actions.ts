import type { EngineUserIdentity, GroupedEngineUser } from '@/lib/contracts'

/**
 * Qué acciones corresponden a un usuario del motor, en UN solo lugar.
 *
 * **Existe porque divergió.** La tabla del servidor (`EngineUsersPanel`) y la ficha
 * (`ServerUserDetailPage`) decidían cada una, con su propio `switch`, qué botones pintar. Eran
 * copias a mano y ya no coincidían: «Agregar host» se ocultaba en la ficha de una identidad
 * huérfana y no en la tabla, y la ficha no tenía ni «Editar» ni «Quitar del inventario», que solo
 * existían en el listado del inventario.
 *
 * Las reglas que este módulo hace cumplir:
 *
 * - **R1. La ficha tiene TODAS las acciones.** Una fila solo puede ofrecer acciones que también
 *   estén en la ficha. Aquí se cumple por construcción: la fila no calcula nada propio, FILTRA la
 *   lista de la ficha (`rowIdentityActions`). Una acción en fila y no en ficha sería un bug.
 * - **R2. Qué acciones hay depende del estado y las capacidades, no de la vista.** La entrada es
 *   la identidad (`adopted`/`unmanaged`/`orphan`, contraseña conocida, registro de inventario),
 *   nunca «en qué pantalla estoy». Lo único que una vista puede restar es lo que no sabe ejecutar
 *   (ver `needsRecord`).
 * - **R5. Una destructiva se nombra por su consecuencia.** «Eliminar del motor 🔌» ejecuta
 *   `DROP USER`; «Quitar del inventario» borra solo el registro del gateway y el usuario sigue en
 *   el motor. Nunca dos acciones distintas con la misma etiqueta.
 *
 * Agregar una acción es tocar este archivo (qué y cuándo), `EngineUserActionButtons` (cómo se
 * pinta) y `use-engine-user-dialogs` (qué abre). Ninguna vista necesita cambiar.
 */

/** Acciones sobre UNA identidad `(servidor, username, host)`. */
export type IdentityActionId =
  | 'adopt'
  | 'viewGrants'
  | 'reveal'
  | 'rotatePassword'
  | 'edit'
  | 'removeFromInventory'
  | 'dropFromEngine'
  | 'recreate'

/** Acciones batch (§7.4) sobre TODAS las identidades de un username. */
export type UsernameActionId = 'addHost' | 'adoptAllHosts' | 'definePassword' | 'rotateAllHosts'

export interface IdentityAction {
  id: IdentityActionId
  /**
   * La acción necesita el registro del inventario completo (`ServerUserOut`), no solo la
   * identidad agrupada. Los diálogos de editar y de quitar una identidad adoptada lo exigen, y la
   * tabla del servidor no lo tiene: pedir un `GET /server-users/{id}` por fila para poder pintar
   * un botón no compensa. La ficha sí lo carga, así que ahí aparecen.
   */
  needsRecord: boolean
}

export interface UsernameAction {
  id: UsernameActionId
  /** Si está, la acción se muestra deshabilitada y este texto dice por qué, visible. */
  disabledReason?: string
}

export const ACTION_LABELS: Record<IdentityActionId | UsernameActionId, string> = {
  adopt: 'Adoptar',
  viewGrants: 'Permisos efectivos',
  reveal: 'Revelar',
  rotatePassword: 'Rotar contraseña',
  edit: 'Editar',
  removeFromInventory: 'Quitar del inventario',
  dropFromEngine: 'Eliminar del motor 🔌',
  recreate: 'Recrear en el motor 🔌',
  addHost: 'Agregar host',
  adoptAllHosts: 'Adoptar todos los hosts',
  definePassword: 'Definir contraseña',
  rotateAllHosts: 'Rotar en todos los hosts',
}

/**
 * Las que borran algo (el registro o el usuario del motor). Van siempre al final y, en la ficha,
 * en su propio grupo, separadas de las acciones inocuas.
 */
export const DESTRUCTIVE_IDENTITY_ACTIONS: ReadonlySet<IdentityActionId> =
  new Set<IdentityActionId>(['removeFromInventory', 'dropFromEngine'])

const ALL_HOSTS_ORPHAN =
  'Ningún host de este usuario existe hoy en el motor (todos huérfanos): no hay de dónde clonarlo.'

const action = (id: IdentityActionId, needsRecord = false): IdentityAction => ({ id, needsRecord })

/**
 * TODAS las acciones de una identidad según su estado: es exactamente lo que ofrece la ficha.
 *
 * - `adopted`: existe en el motor y en el inventario, así que admite las dos destructivas, cada
 *   una con su consecuencia (R5).
 * - `unmanaged`: solo en el motor. No hay registro que editar ni que quitar.
 * - `orphan`: solo en el inventario (se borró por fuera del gateway). No hay nada que rotar ni
 *   que eliminar del motor; quitarla del inventario es inmediato porque no hay nada físico que
 *   perder, y por eso no necesita el registro completo.
 */
export function identityActions(identity: EngineUserIdentity): IdentityAction[] {
  const hasRecord = identity.server_user_id != null
  switch (identity.status) {
    case 'adopted':
      return [
        action('viewGrants'),
        ...(identity.has_password ? [action('reveal')] : []),
        action('rotatePassword'),
        ...(hasRecord ? [action('edit', true), action('removeFromInventory', true)] : []),
        action('dropFromEngine'),
      ]
    case 'unmanaged':
      return [
        action('adopt'),
        action('viewGrants'),
        action('rotatePassword'),
        action('dropFromEngine'),
      ]
    case 'orphan':
      // La destructiva al final, como en los otros dos estados: en medio de «Recrear» y
      // «Permisos efectivos» quedaba donde se pulsa por inercia.
      return [
        action('recreate'),
        ...(hasRecord ? [action('edit', true)] : []),
        action('viewGrants'),
        ...(hasRecord ? [action('removeFromInventory')] : []),
      ]
  }
}

/**
 * Las acciones de una identidad en una FILA de tabla: las de la ficha menos las que la fila no
 * sabe ejecutar. Filtrar —y no recalcular— es lo que garantiza R1.
 */
export function rowIdentityActions(identity: EngineUserIdentity): IdentityAction[] {
  return identityActions(identity).filter((candidate) => !candidate.needsRecord)
}

/**
 * Hosts EN VIVO (no `orphan`) de un username. Son el origen posible para clonar una identidad
 * —`SHOW CREATE USER` fallaría sobre una que ya no existe— y las opciones del alcance «una
 * identidad» al definir una contraseña conocida.
 */
export function liveHostsOf(user: GroupedEngineUser): string[] {
  return user.identities
    .filter((identity) => identity.status !== 'orphan')
    .map((identity) => identity.host)
    .filter((host): host is string => Boolean(host))
}

/**
 * Acciones batch de un username. Dependen del CONJUNTO de sus identidades, nunca de cuál se está
 * mirando: por eso «Agregar host» no se oculta en la ficha de una identidad huérfana si otro host
 * del mismo usuario sigue vivo — clonar ese otro es justo cómo se repone el acceso.
 *
 * - Agregar host: solo con hosts; deshabilitado (con el motivo) si no queda ninguno vivo.
 * - Adoptar todos los hosts: solo con hosts y ≥1 identidad `unmanaged` (en PostgreSQL la única
 *   identidad ya tiene su «Adoptar» propio).
 * - Definir contraseña: siempre (flujo DEFINIR, distinto de ROTAR: no toca el motor).
 * - Rotar en todos los hosts: solo con hosts y >1 identidad (con una sola ya existe la rotación
 *   individual).
 */
export function usernameActions(user: GroupedEngineUser, supportsHosts: boolean): UsernameAction[] {
  const actions: UsernameAction[] = []
  if (supportsHosts) {
    actions.push({
      id: 'addHost',
      disabledReason: liveHostsOf(user).length === 0 ? ALL_HOSTS_ORPHAN : undefined,
    })
  }
  if (supportsHosts && user.identities.some((identity) => identity.status === 'unmanaged')) {
    actions.push({ id: 'adoptAllHosts' })
  }
  actions.push({ id: 'definePassword' })
  if (supportsHosts && user.identity_count > 1) actions.push({ id: 'rotateAllHosts' })
  return actions
}
