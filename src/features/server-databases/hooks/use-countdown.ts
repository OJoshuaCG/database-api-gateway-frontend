import { useEffect, useState } from 'react'
import { remainingMs } from '../logic'

/** Cadencia del tick: submúltiplo del segundo para que el `mm:ss` no se vea saltar. */
const TICK_MS = 250

/**
 * Cuenta atrás de vigencia del `confirm_token` del borrado.
 *
 * `expiresAt` (ISO 8601 UTC) es la ÚNICA fuente de verdad: el TTL nominal es de 120 s pero
 * empieza a correr en el servidor, así que no se asume "120 s desde que llegó la respuesta".
 * `remainingMs` aplica además un margen por desfase de reloj del cliente ([SUPUESTO S2]).
 *
 * El instante actual vive en estado y solo lo escribe el intervalo: leer `Date.now()` en render
 * sería impuro (`react-hooks/purity`) y produciría resultados inestables entre renders. El tick
 * es de 250 ms para que, al llegar un token nuevo, el restante se corrija antes de ser visible.
 *
 * Devuelve `0` cuando no hay token vigente, lo que la UI usa para deshabilitar la acción
 * destructiva ANTES de intentar el request.
 */
export function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [expiresAt])

  return expiresAt ? remainingMs(expiresAt, now) : 0
}
