/** Ruta pública de aceptación (ver `src/app/router.tsx`). */
export const INVITE_ACCEPT_PATH = '/invitacion'

/**
 * Link completo que se le entrega a la persona invitada.
 *
 * Se arma con el origen del frontend que está viendo el admin: el gateway no conoce la URL
 * pública del frontend, y quien crea la cuenta está, por definición, usando esa misma URL.
 *
 * **El token va en el FRAGMENTO (`#token=`), no en la query.** El navegador nunca manda el
 * fragmento al servidor: no llega al access log de nginx ni al `Referer` de los chunks y assets
 * que la página pide al cargar. Con `?token=` la credencial quedaba en los dos antes de que la
 * página alcanzara a quitarla de la barra.
 */
export function buildInviteLink(token: string, origin: string = window.location.origin): string {
  const url = new URL(INVITE_ACCEPT_PATH, origin)
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

/**
 * El token que trae una dirección: del fragmento (`#token=`, el formato actual) o de la query
 * (`?token=`, el de los enlaces ya entregados antes del cambio). `null` si no trae ninguno.
 */
export function inviteTokenFromLocation(location: { search: string; hash: string }): string | null {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')?.trim()
  if (fromHash) return fromHash
  const fromQuery = new URLSearchParams(location.search).get('token')?.trim()
  return fromQuery || null
}

/**
 * Normaliza lo que la persona pega en el campo del token: acepta el token solo o el link completo
 * (con el token en el fragmento o, si es un enlace viejo, en la query).
 *
 * Lo que se entrega es el link, así que pegarlo entero en el campo es el error esperable;
 * rechazarlo como «token inválido» dejaría a alguien afuera por un detalle de formato.
 */
export function extractInviteToken(input: string): string {
  const value = input.trim()
  if (!value.includes('?') && !value.includes('#')) return value
  try {
    const url = new URL(value)
    return inviteTokenFromLocation(url) ?? value
  } catch {
    return value
  }
}
