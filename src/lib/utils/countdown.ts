/**
 * Cuenta atrás de vigencia de los `confirm_token` firmados que emite el backend (borrado de
 * bases de datos, consola SQL). Lógica PURA: sin React ni `Date.now()`, para poder testearla
 * y para no romper `react-hooks/purity` cuando se llama en render.
 *
 * El instante de vencimiento SIEMPRE llega del backend (`expires_at`, ISO 8601 UTC): el TTL
 * nominal empieza a correr en el servidor, así que asumir "N segundos desde que llegó la
 * respuesta" acumularía el tiempo de red y mostraría más margen del real.
 */

/**
 * Margen por desfase de reloj del cliente: damos el token por vencido 2 s antes de su
 * `expires_at` real. Es preferible re-pedir el preview de más a mandar un token que el
 * backend ya considera expirado (410).
 */
export const CLOCK_SKEW_MARGIN_MS = 2_000

/** Milisegundos restantes de vigencia del token, nunca negativo. `expiresAt` es ISO 8601 UTC. */
export function remainingMs(expiresAt: string, now: number): number {
  const deadline = Date.parse(expiresAt)
  if (Number.isNaN(deadline)) return 0
  return Math.max(0, deadline - CLOCK_SKEW_MARGIN_MS - now)
}

/** `mm:ss` para la cuenta atrás de los diálogos de confirmación. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
