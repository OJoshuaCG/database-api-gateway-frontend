/**
 * Token CSRF de la sesión (api-reference-v23 §7.1).
 *
 * El backend lo deja en una cookie **legible por JS a propósito** —no es httpOnly— y exige que
 * viaje de vuelta en el header `X-CSRF-Token`. No es un double-submit: el servidor lo **recomputa**
 * a partir del identificador de sesión, así que plantar la cookie desde el cliente no sirve de
 * nada. Si ves un 403 `auth.csrf_invalid`, el arreglo NUNCA es escribir la cookie.
 */

/**
 * Nombres de la cookie, en orden de preferencia.
 *
 * El prefijo `__Host-` exige `Secure` y por lo tanto HTTPS, así que en desarrollo sobre HTTP el
 * backend usa el nombre pelado. Se leen los dos y gana el prefijado: si por lo que sea están las
 * dos presentes, la que vale es la que el navegador ató al origen seguro.
 */
const COOKIE_NAMES = ['__Host-gw_csrf', 'gw_csrf'] as const

/** Header en el que el backend espera el token. */
export const CSRF_HEADER = 'X-CSRF-Token'

/**
 * Lee el token de la cookie, o `null` si todavía no existe.
 *
 * **Se lee en CADA request, sin cachear, y eso es deliberado.** El token se deriva del
 * identificador de sesión y ese identificador cambia en cada login: un valor guardado en memoria
 * al arrancar la app daría `auth.csrf_invalid` después de cerrar y volver a iniciar sesión. Leer
 * `document.cookie` es una operación local barata; sostener una copia sincronizada con la sesión
 * costaría un flujo de invalidación entero para ahorrar microsegundos.
 *
 * Como el middleware del backend repone la cookie en **cualquier** respuesta con sesión —no solo
 * en la del login—, tampoco hace falta un camino de recuperación: la siguiente lectura ya la ve.
 */
export function readCsrfToken(): string | null {
  // `document` no existe en SSR ni en algunos entornos de test; sin él no hay cookie que leer.
  if (typeof document === 'undefined') return null

  const jar = document.cookie
  if (!jar) return null

  for (const name of COOKIE_NAMES) {
    for (const part of jar.split(';')) {
      const separator = part.indexOf('=')
      if (separator === -1) continue
      if (part.slice(0, separator).trim() !== name) continue
      const raw = part.slice(separator + 1).trim()
      if (raw.length === 0) continue
      // El backend no lo escapa, pero `decodeURIComponent` sobre un valor sin escapar es la
      // identidad. Se envuelve igual porque un `%` suelto lo haría lanzar y tirar todo el request.
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}
