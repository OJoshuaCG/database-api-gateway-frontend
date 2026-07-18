import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores del asistente de clonado a una ACCIÓN accionable (§ Matriz de errores
 * del documento de referencia). El backend no expone un código de razón estructurado para
 * 409/422 (siempre `type: "AppHttpException"`), así que se reconoce la variante por fragmentos
 * ESTABLES del `detail.msg` documentado — con un `default` que nunca rompe: si el texto no calza
 * con ningún patrón conocido, se trata como un error genérico y se muestra igual el `detail.msg`
 * real (nunca se oculta información al usuario).
 */

export type CloneErrorAction =
  | 'replan'
  | 'forceQuarantine'
  | 'fixConfirmName'
  | 'recomputeToken'
  | 'switchToExistingTarget'
  | 'switchToNewTarget'
  | 'rateLimited'
  | 'none'

const MESSAGE_PATTERNS: [RegExp, CloneErrorAction][] = [
  [/expiró/i, 'replan'],
  [/esquema del origen cambió/i, 'replan'],
  [/ya está en estado/i, 'replan'],
  [/cuarentena/i, 'forceQuarantine'],
  [/confirm_target_name no coincide|nombre de confirmación no coincide/i, 'fixConfirmName'],
  [/confirm_token no coincide|token de confirmación no coincide/i, 'recomputeToken'],
  // "La BD destino '...' ya existe. Usá target_mode='existing'." (create, target_mode='new')
  [/target_mode='existing'/i, 'switchToExistingTarget'],
  // "La BD destino '...' no existe. Usá target_mode='new'." (create, target_mode='existing')
  [/target_mode='new'/i, 'switchToNewTarget'],
]

/** Clasifica un `ApiError` del flujo de clonado en una acción de UI recomendada. */
export function classifyCloneError(error: ApiError): CloneErrorAction {
  if (error.status === 410) return 'replan'
  if (error.status === 429) return 'rateLimited'
  for (const [pattern, action] of MESSAGE_PATTERNS) {
    if (pattern.test(error.message)) return action
  }
  return 'none'
}

export const CLONE_ACTION_LABELS: Record<CloneErrorAction, string | null> = {
  replan: 'Replanear',
  forceQuarantine: 'Reintentar con force',
  fixConfirmName: null,
  recomputeToken: 'Recomputar vista previa',
  switchToExistingTarget: "Cambiar a 'existing'",
  switchToNewTarget: "Cambiar a 'new'",
  rateLimited: null,
  none: null,
}

/** Texto de apoyo (bajo el mensaje del backend) para las acciones que lo necesitan. */
export const CLONE_ACTION_HINTS: Partial<Record<CloneErrorAction, string>> = {
  replan: 'El plan ya no es válido (expiró, ya se ejecutó, o el origen cambió). Crea un plan nuevo para continuar.',
  forceQuarantine:
    'El destino está en cuarentena. Solo si ya lo inspeccionaste, reintenta forzando la operación.',
  recomputeToken:
    'El plan cambió desde la última vista previa; se recomputará automáticamente el token.',
  switchToExistingTarget: "La BD destino ya existe: cambia el modo a 'existing' para usarla.",
  switchToNewTarget: "La BD destino no existe: cambia el modo a 'new' para crearla.",
  rateLimited: 'Se alcanzó el límite de solicitudes. Espera unos segundos e inténtalo de nuevo.',
}
