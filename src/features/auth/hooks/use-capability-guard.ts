import type { Capability } from '@/lib/contracts'
import { useCapabilities } from './use-capabilities'

export interface CapabilityGuard {
  /** `false` = el control tiene que ir deshabilitado. */
  allowed: boolean
  /** Texto para el `hint` del control cuando está deshabilitado; `undefined` cuando está permitido. */
  hint: string | undefined
}

/**
 * Guarda de UI para los controles del §4: los que **suben el requisito según el parámetro**.
 *
 * Son cinco casos —encender la captura de SELECT, sembrar datos en un snapshot, y los dos
 * `drop_remote`— y todos comparten la misma forma del problema: el usuario ya está en la pantalla,
 * ya llenó el formulario, y el 403 llegaría recién al enviar. Deshabilitar el control concreto
 * convierte un rechazo tardío en una restricción visible desde el principio.
 *
 * **Acá SÍ se nombra la capacidad que falta**, al revés que en el 403 (§3). No es una contradicción:
 * el 403 la oculta para no darle a un atacante un mapa de la superficie por fuerza bruta, pero
 * `/auth/me` ya le publica al usuario sus propias capacidades. Decirle cuál le falta no le revela
 * nada que no pueda leer de su propia sesión, y le da algo concreto que pedirle a quien administra
 * accesos en vez de un «no podés» sin salida.
 *
 * Cuando el backend no publica capacidades, `can` falla ABIERTO y esto no deshabilita nada: ver
 * `useCapabilities`.
 */
export function useCapabilityGuard(
  capability: Capability,
  /** Qué acción describe, en infinitivo y en minúscula: «encender la captura de resultados». */
  action: string,
): CapabilityGuard {
  const { can } = useCapabilities()
  const allowed = can(capability)
  return {
    allowed,
    hint: allowed
      ? undefined
      : `Tu rol no permite ${action}. Requiere la capacidad «${capability}»: pedísela a quien administra los accesos.`,
  }
}
