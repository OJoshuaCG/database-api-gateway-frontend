import { useEffect, useState } from 'react'

/**
 * Devuelve `value` retrasado `delayMs`. Sirve para no consultar el motor 🔌 en cada pulsación
 * cuando el valor lo escribe una persona (un buscador, un filtro, un `WHERE`).
 *
 * **No es lo mismo que `useDeferredValue`**, y confundirlos cuesta caro: `useDeferredValue` solo
 * colapsa las actualizaciones dentro de un mismo ciclo de render, así que con renders baratos y
 * tecleo normal deja pasar **una petición por carácter**. Contra un endpoint de 10/min eso son seis
 * palabras hasta el 429. Los dos se combinan bien: primero se amortigua el tecleo con esto, y el
 * diferido se queda con lo que aporta —mantener la interfaz responsiva durante el recálculo.
 *
 * El `setState` va dentro del callback del temporizador, no en el cuerpo del efecto: `react-hooks`
 * prohíbe el `setState` síncrono dentro de un `useEffect`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
