/** Ruta pública de aceptación (ver `src/app/router.tsx`). */
export const INVITE_ACCEPT_PATH = '/invitacion'

/**
 * Link completo que se le entrega a la persona invitada.
 *
 * Se arma con el origen del frontend que está viendo el admin: el gateway no conoce la URL
 * pública del frontend, y quien crea la cuenta está, por definición, usando esa misma URL.
 */
export function buildInviteLink(token: string, origin: string = window.location.origin): string {
  const url = new URL(INVITE_ACCEPT_PATH, origin)
  url.searchParams.set('token', token)
  return url.toString()
}

/**
 * Normaliza lo que la persona pega en el campo del token: acepta el token solo o el link completo.
 *
 * Lo que se entrega es el link, así que pegarlo entero en el campo es el error esperable;
 * rechazarlo como «token inválido» dejaría a alguien afuera por un detalle de formato.
 */
export function extractInviteToken(input: string): string {
  const value = input.trim()
  if (!value.includes('?')) return value
  try {
    return new URL(value).searchParams.get('token')?.trim() || value
  } catch {
    return value
  }
}
