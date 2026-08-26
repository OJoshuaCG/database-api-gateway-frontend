import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores del asistente de conversión de collation a una ACCIÓN accionable.
 *
 * ⚠️ **Conviven DOS mecanismos en este archivo, y no por gusto.**
 *
 * Los rechazos NUEVOS del módulo (lote, versión, alcance — v17 §5) traen `public_context.code`
 * con vocabulario cerrado, y se clasifican por ahí: ver `CODE_ACTIONS`. Los textos de esos
 * códigos viven en `../messages.ts`.
 *
 * Los OCHO errores viejos del flujo unitario **siguen sin código** (v17 §7): 409/422 con
 * `type: "AppHttpException"` y casi todo el contexto en `detail.context`, que es dev-only. Para
 * esos no queda más que reconocer fragmentos del `detail.msg`, que es lo que hace
 * `MESSAGE_PATTERNS`. **Es frágil a propósito y está registrado como deuda**
 * (`T-260825-lz-collation-codigos-viejos`): reescribir un mensaje en español —algo que nadie
 * considera un cambio de contrato— degrada esta clasificación en silencio. Cuando esos ocho
 * tengan código, `MESSAGE_PATTERNS` se borra entero.
 *
 * El fallback nunca oculta el mensaje real: si no calza ni código ni patrón, se devuelve `none` y
 * el llamador muestra el `detail.msg` tal cual, sin CTA.
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

/**
 * Códigos estructurados → acción, para los rechazos que SÍ tienen `public_context.code` (v17 §5).
 *
 * Se consultan ANTES que `MESSAGE_PATTERNS`, y ese orden es la parte importante: un código es
 * contrato, la prosa no. Mientras los ocho errores viejos sigan sin código conviven los dos
 * mecanismos en este archivo, y el de abajo es el que degrada en silencio cuando alguien reescribe
 * un mensaje en español sin considerarlo un cambio de contrato.
 */
const CODE_ACTIONS: Record<string, ConversionErrorAction> = {
  // El conjunto de bases cambió desde que se planificó: el plan entero dejó de ser válido.
  'collation.batch_database_set_mismatch': 'replan',
  // El lote ya se ejecutó o se canceló: no hay nada que reintentar sobre este.
  'collation.batch_not_pending': 'replan',
  // Faltan re-tipeos de bases en entorno protegido. `force` NO lo saltea.
  'collation.batch_confirmation_required': 'fixConfirmName',
  // No hay ninguna base activa: hay que revisar qué se eligió, no reintentar.
  'collation.batch_no_eligible_databases': 'reviewSelection',
}

/**
 * Clasifica un `ApiError` del flujo de conversión de collation en una acción de UI recomendada.
 *
 * ORDEN: estado HTTP → **`error.code`** → prosa. El código va antes que la expresión regular
 * porque es lo único estable; la prosa queda como respaldo solo mientras los ocho errores viejos
 * del módulo no tengan código (v17 §7, deuda `T-260825-lz-collation-codigos-viejos`). Cuando lo
 * tengan, `MESSAGE_PATTERNS` se borra y este orden ya no importa.
 *
 * El fallback nunca oculta el mensaje real: si nada calza, se devuelve `none` y el llamador
 * muestra el `detail.msg` del backend tal cual, sin CTA.
 */
export function classifyConversionError(error: ApiError): ConversionErrorAction {
  if (error.status === 410) return 'replan'
  if (error.status === 429) return 'rateLimited'
  const byCode = error.code ? CODE_ACTIONS[error.code] : undefined
  if (byCode) return byCode
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
