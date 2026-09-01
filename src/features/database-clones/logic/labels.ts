import type { BadgeTone } from '@/components/ui'
import type { CloneCopyIntent, ClonePhase, CloneStatus } from '@/lib/contracts'

/**
 * Etiquetas y tonos del estado de un clon, en un solo lugar.
 *
 * Vivían inlineadas en el monitor del asistente. Con el historial y la vista de operación
 * pasaron a tener tres consumidores, y tres copias del mapeo estado→color divergen: el color
 * ES la información en estas pantallas.
 */
export const CLONE_STATUS_LABELS: Record<CloneStatus, string> = {
  pending: 'sin ejecutar',
  running: 'en curso',
  succeeded: 'completada',
  failed: 'falló',
  interrupted: 'interrumpida',
  canceled: 'cancelada',
}

export const CLONE_STATUS_TONES: Record<CloneStatus, BadgeTone> = {
  pending: 'neutral',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  interrupted: 'warning',
  canceled: 'neutral',
}

export const COPY_INTENT_LABELS: Record<CloneCopyIntent, string> = {
  structure_only: 'Solo estructura',
  structure_and_data: 'Estructura y datos',
  data_only: 'Solo datos',
}

export const CLONE_PHASE_LABELS: Record<ClonePhase, string> = {
  clean: 'Limpieza',
  structure: 'Estructura',
  data: 'Datos',
  adopt: 'Adopción',
  done: 'Listo',
}
