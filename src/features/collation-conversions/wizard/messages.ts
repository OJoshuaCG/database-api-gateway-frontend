import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores del asistente de conversión de collation a una ACCIÓN accionable
 * (mismo criterio que `database-clones/wizard/messages.ts`). El backend no expone un código de
 * razón estructurado para los 409/422 de este módulo (siempre `type: "AppHttpException"`, y casi
 * todo con `detail.context` dev-only), así que se reconoce la variante por fragmentos ESTABLES
 * del `detail.msg` — con un fallback que nunca oculta el mensaje real: si el texto no calza con
 * ningún patrón conocido, se muestra igual el `detail.msg` tal cual, sin CTA.
 *
 * Nota: `ApiError.charsetRejected` (422 MySQL/MariaDB) y `ApiError.postgresCollationRejected`
 * (422 PostgreSQL) son manejo específico del `PlanStep` — no pasan por este clasificador genérico.
 */

export type ConversionErrorAction =
  | 'replan'
  | 'forceStaleInventory'
  | 'forceQuarantine'
  | 'forceStaleAtExecute'
  | 'recomputeToken'
  | 'fixConfirmName'
  | 'reviewSelection'
  | 'previewFirst'
  | 'rateLimited'
  | 'none'

const MESSAGE_PATTERNS: [RegExp, ConversionErrorAction][] = [
  // 409 "el job ya está en estado ... crea un plan nuevo"
  [/ya está en estado/i, 'replan'],
  // 409 preview: "El inventario de la base de datos cambió desde que se creó el plan"
  [/inventario.*cambió desde que se creó el plan/i, 'forceStaleInventory'],
  // 409 execute: "La base de datos está en cuarentena"
  [/cuarentena/i, 'forceQuarantine'],
  // 409 execute: "El inventario de la base de datos cambió desde el preview"
  [/inventario.*cambió desde el preview/i, 'forceStaleAtExecute'],
  // 422 execute: "confirm_token no coincide con el plan actual"
  [/confirm_token no coincide con el plan actual/i, 'recomputeToken'],
  // 422 execute: "confirm_target_name no coincide con el nombre de la base de datos"
  [/confirm_target_name no coincide con el nombre de la base de datos/i, 'fixConfirmName'],
  // 422 execute: "El plan no tiene ningún paso que ejecutar"
  [/el plan no tiene ningún paso que ejecutar/i, 'reviewSelection'],
  // 409 execute: "Falta previsualizar el plan antes de ejecutarlo"
  [/falta previsualizar el plan antes de ejecutarlo/i, 'previewFirst'],
]

/** Clasifica un `ApiError` del flujo de conversión de collation en una acción de UI recomendada. */
export function classifyConversionError(error: ApiError): ConversionErrorAction {
  if (error.status === 410) return 'replan'
  if (error.status === 429) return 'rateLimited'
  for (const [pattern, action] of MESSAGE_PATTERNS) {
    if (pattern.test(error.message)) return action
  }
  return 'none'
}

export const CONVERSION_ACTION_LABELS: Record<ConversionErrorAction, string | null> = {
  replan: 'Replanear',
  forceStaleInventory: 'Recomputar vista previa',
  forceQuarantine: 'Reintentar con force',
  forceStaleAtExecute: 'Reintentar con force',
  recomputeToken: 'Recomputar vista previa',
  fixConfirmName: null,
  reviewSelection: 'Revisar selección',
  previewFirst: 'Previsualizar',
  rateLimited: null,
  none: null,
}

/** Texto de apoyo (bajo el mensaje del backend) para las acciones que lo necesitan. */
export const CONVERSION_ACTION_HINTS: Partial<Record<ConversionErrorAction, string>> = {
  replan: 'El plan ya no es válido (expiró o ya cambió de estado). Crea un plan nuevo para continuar.',
  forceStaleInventory:
    'El inventario de la base de datos cambió desde que se creó el plan; recomputa la vista previa.',
  forceQuarantine:
    'La base de datos está en cuarentena. Solo si ya la inspeccionaste, reintenta forzando la operación.',
  forceStaleAtExecute:
    'El inventario cambió desde la última vista previa. Solo si ya revisaste el impacto, reintenta forzando la operación.',
  recomputeToken: 'El plan cambió desde la última vista previa; se recomputará automáticamente el token.',
  reviewSelection: 'No hay ningún paso pendiente con la selección actual: marca al menos una tabla u objeto.',
  previewFirst: 'Genera la vista previa del plan antes de poder ejecutarlo.',
  rateLimited: 'Se alcanzó el límite de solicitudes. Espera unos segundos e inténtalo de nuevo.',
}
