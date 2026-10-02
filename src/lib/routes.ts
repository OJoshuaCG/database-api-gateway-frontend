/**
 * Rutas de las fichas de entidad, en un solo lugar.
 *
 * **Existe porque divergió.** La ruta de la ficha de una base se armaba a mano en tres sitios y la
 * de un usuario del motor en otros tres, con la misma plantilla escrita cada vez. Una plantilla
 * copiada no falla: se desincroniza. Y en esta app eso tiene una forma concreta —un listado que
 * sigue enlazando a una ruta vieja, o que se olvida de codificar un nombre con «$» y rompe el
 * segmento de la URL— que nadie detecta hasta que un enlace lleva a otra entidad.
 *
 * Los nombres se codifican siempre: las bases y los usuarios legados pueden llevar «.», «-», «$»
 * o «@», que de otro modo romperían el segmento.
 */

/** Pestañas de la ficha de una base (`ServerDatabaseDetailPage`). */
export type ServerDatabaseTab = 'grantees' | 'summary' | 'migrations' | 'collation'

/**
 * Ficha unificada de una base de datos: `/servers/:serverId/databases/:database`.
 *
 * Se identifica por su identidad FÍSICA `(servidor, nombre)`, no por el id del inventario: es la
 * misma ruta esté o no gestionada la base, y la ficha decide qué mostrar según su estado.
 */
export function serverDatabasePath(
  serverId: number,
  database: string,
  tab?: ServerDatabaseTab,
): string {
  const path = `/servers/${serverId}/databases/${encodeURIComponent(database)}`
  return tab ? `${path}?tab=${tab}` : path
}

/** Pestañas de la ficha de un usuario del motor (`ServerUserDetailPage`). */
export type ServerUserTab = 'identity' | 'grants' | 'manage' | 'databases'

/**
 * Ficha unificada de un usuario del motor: `/servers/:serverId/users/:username/:host?`.
 *
 * `host` va ausente en PostgreSQL, que no lo tiene. Como la de una base, es la misma ruta esté o
 * no adoptada la identidad.
 */
export function serverUserPath(
  serverId: number,
  username: string,
  host?: string | null,
  tab?: ServerUserTab,
): string {
  const hostSegment = host ? `/${encodeURIComponent(host)}` : ''
  const path = `/servers/${serverId}/users/${encodeURIComponent(username)}${hostSegment}`
  return tab ? `${path}?tab=${tab}` : path
}

/** Listado de usuarios del gateway (pestaña «Usuarios»). */
export const GATEWAY_USERS_PATH = '/gateway-users'

/**
 * Editor de accesos de un usuario del gateway: `/gateway-users/:userId/accesos`. Era un modal y
 * pasó a página propia: con capacidades globales, permisos por alcance y el acceso efectivo, no
 * entraba en un diálogo sin volverse un scroll interminable.
 */
export function gatewayUserAccessPath(userId: number): string {
  return `${GATEWAY_USERS_PATH}/${userId}/accesos`
}

/**
 * Una elevación de acceso pendiente (v29 §9), dentro de la bandeja «Solicitudes pendientes» de
 * `/gateway-users`. No hay página propia: `?solicitud=` la destaca arriba de la bandeja con su
 * estado ACTUAL (`GET /access-requests/{id}`), que es lo que sirve cuando se llega desde el aviso
 * de un `202` y otra persona ya la decidió.
 */
export const ACCESS_REQUEST_PARAM = 'solicitud'

export function accessRequestPath(requestId: number): string {
  return `${GATEWAY_USERS_PATH}?tab=pending&${ACCESS_REQUEST_PARAM}=${requestId}`
}

/**
 * Auditoría (`GET /audit-log`, v29 §11.3). Los filtros viven en la URL, así que un enlace a una
 * búsqueda —«todo lo de este request», `?request_id=`— se comparte tal cual. `?entrada=` abre el
 * detalle de una fila (`GET /audit-log/{id}`).
 */
export const AUDIT_LOG_PATH = '/audit-log'
