/**
 * UUID v4 aleatorio.
 *
 * No usa `crypto.randomUUID()` a secas porque **solo existe en contextos seguros**: HTTPS o
 * `localhost`. Este gateway se despliega también sobre HTTP plano en red interna (de ahí los
 * guardas `if (!navigator.clipboard)` repartidos por la UI, que son el mismo problema), y ahí
 * `crypto.randomUUID` es `undefined`: llamarlo lanza `TypeError` y el manejador muere entero, así
 * que el botón «no hace nada» sin dejar ni un toast.
 *
 * `crypto.getRandomValues()` sí está disponible fuera de un contexto seguro —no es de
 * `SubtleCrypto`, que es la parte restringida— así que el respaldo tiene la misma calidad de
 * aleatoriedad, no es un `Math.random()` disfrazado.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // RFC 4122: versión (4) en el nibble alto del byte 6 y variante (10xx) en el del byte 8. El
  // `?? 0` es ruido de `noUncheckedIndexedAccess`, no un caso real: el array mide 16.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
