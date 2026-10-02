import { createContext, useContext } from 'react'
import type { Capability } from '@/lib/contracts'

/**
 * El step-up de la app, provisto por `StepUpProvider`.
 *
 * El servidor ya lo exige solo y `runRequest` lo atiende solo (403 → contraseña → un reenvío), así
 * que esto existe para UNA cosa: preguntar ANTES de abrir una confirmación con `confirm_token`,
 * cuando a la ventana le queda poco. Si no, la contraseña se pediría en el execute, con el token
 * ya corriendo.
 */
export interface StepUpContextValue {
  /**
   * Resuelve `true` si se puede seguir: la capacidad no pide step-up, la ventana tiene margen, o la
   * persona acaba de confirmar la contraseña. `false` = canceló.
   */
  ensureFresh: (capability: Capability) => Promise<boolean>
  /**
   * Igual que `ensureFresh`, pero ejecuta `action` **en el mismo tick** cuando no hace falta
   * preguntar —el caso normal—, sin cambiar el comportamiento síncrono del handler que lo llama.
   * `onCancel` corre si la persona cancela el pedido.
   */
  withFresh: (capability: Capability, action: () => void, onCancel?: () => void) => void
  /** Abre el pedido de contraseña sin mirar nada (o se suma al que ya está abierto). */
  requestStepUp: () => Promise<boolean>
}

/**
 * Sin proveedor (tests de un componente suelto) no se pregunta nada: se sigue de largo, que es lo
 * que pasaba antes del step-up. Si el servidor lo exige, el 403 sale como error.
 */
const PASSTHROUGH: StepUpContextValue = {
  ensureFresh: () => Promise.resolve(true),
  withFresh: (_capability, action) => action(),
  requestStepUp: () => Promise.resolve(false),
}

export const StepUpContext = createContext<StepUpContextValue>(PASSTHROUGH)

export function useStepUp(): StepUpContextValue {
  return useContext(StepUpContext)
}
