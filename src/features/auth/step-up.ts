import type { AdminOut, Capability } from '@/lib/contracts'

/**
 * Lógica pura del step-up («sudo mode»): cuándo conviene pedir la contraseña ANTES de que el
 * servidor la exija. Sin React, para probarla sin montar nada.
 */

/**
 * Margen del preflight. Un `confirm_token` vive 120 s: si la ventana se cierra en medio de la
 * confirmación, el execute da 403, el pedido de contraseña se come el tiempo que le quedaba al
 * token y el reenvío termina en 410. Con menos de un minuto por delante se pregunta primero.
 */
export const STEP_UP_PREFLIGHT_MARGIN_MS = 60_000

/** ¿Trae zona horaria (`Z` u offset `±hh:mm`)? */
const HAS_TIMEZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/**
 * Lee un instante UTC del backend en milisegundos, o `null` si no hay o no se entiende.
 *
 * `step_up_expires_at` viaja **sin zona** (`2026-10-02T12:05:00`) y es UTC. `Date.parse` de una
 * fecha-hora ISO sin zona la interpreta en hora LOCAL, así que en Buenos Aires la ventana duraría
 * tres horas más de lo que dura de verdad y el preflight no preguntaría nunca.
 */
export function parseUtcInstant(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(HAS_TIMEZONE.test(value) ? value : `${value}Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * ¿Hay que pedir la contraseña antes de empezar una operación con `capability`?
 *
 * Solo si el servidor exige step-up (`step_up_enforced`), la capacidad lo pide para este actor
 * (`step_up_capabilities`) y a la ventana le queda menos que el margen. Sin sesión en caché no se
 * pregunta nada: el request irá igual y, si hace falta, el 403 lo resuelve `runRequest`.
 */
export function needsStepUpPreflight(
  admin: AdminOut | null | undefined,
  capability: Capability,
  nowMs: number,
): boolean {
  if (!admin?.step_up_enforced) return false
  if (!admin.step_up_capabilities.includes(capability)) return false
  const expiresAt = parseUtcInstant(admin.step_up_expires_at)
  return expiresAt === null || expiresAt - nowMs < STEP_UP_PREFLIGHT_MARGIN_MS
}
