import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores del asistente de clonado a una ACCIÓN accionable (§ Matriz de errores
 * del documento de referencia).
 *
 * Se clasifica por `public_context.code` (`ApiError.code`), el vocabulario CERRADO que el backend
 * publica en `clone_spec.ERROR_CODES`. Antes esto eran expresiones regulares sobre la prosa del
 * `detail.msg` (`/expiró/i`, `/cuarentena/i`…): bastaba con reescribir una frase —o traducirla—
 * para que el CTA de recuperación desapareciera sin que nada fallara. Un código es contrato; la
 * prosa no.
 *
 * Un código desconocido —o su ausencia— cae en `none`: no se ofrece CTA, pero `ErrorState` sigue
 * mostrando el `detail.msg` real, así que nunca se oculta información al operador.
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

/**
 * Los códigos de `clone_spec` que llevan a una acción concreta. Solo los que tienen salida en
 * este asistente: el resto (reglas de la spec, bloqueos de alcance…) no tiene un botón que los
 * arregle, y `ErrorState` ya muestra su mensaje.
 */
export const CLONE_ERROR_CODES = {
  planExpired: 'clone.plan_expired',
  alreadyExecuted: 'clone.already_executed',
  sourceFingerprintChanged: 'clone.source_fingerprint_changed',
  targetFingerprintChanged: 'clone.target_fingerprint_changed',
  targetQuarantined: 'clone.target_quarantined',
  confirmNameMismatch: 'clone.confirm_name_mismatch',
  tokenMismatch: 'clone.token_mismatch',
  targetAlreadyExists: 'clone.target_already_exists',
  targetNotFound: 'clone.target_not_found',
} as const

// `Map` y no un objeto: un código como `constructor` no puede resolverse contra el prototipo.
const ACTION_BY_CODE = new Map<string, CloneErrorAction>([
  // El plan ya no describe la realidad: venció, ya corrió, o el origen/destino cambió desde que se
  // fotografió (anti-TOCTOU). En todos, la única salida es planear de nuevo.
  [CLONE_ERROR_CODES.planExpired, 'replan'],
  [CLONE_ERROR_CODES.alreadyExecuted, 'replan'],
  [CLONE_ERROR_CODES.sourceFingerprintChanged, 'replan'],
  [CLONE_ERROR_CODES.targetFingerprintChanged, 'replan'],
  [CLONE_ERROR_CODES.targetQuarantined, 'forceQuarantine'],
  [CLONE_ERROR_CODES.confirmNameMismatch, 'fixConfirmName'],
  [CLONE_ERROR_CODES.tokenMismatch, 'recomputeToken'],
  // `target_mode='new'` contra una base que ya existe, y `'existing'` contra una que no.
  [CLONE_ERROR_CODES.targetAlreadyExists, 'switchToExistingTarget'],
  [CLONE_ERROR_CODES.targetNotFound, 'switchToNewTarget'],
])

/** Clasifica un `ApiError` del flujo de clonado en una acción de UI recomendada. */
export function classifyCloneError(error: ApiError): CloneErrorAction {
  // Por status antes que por código: un 410 es «el plan venció» lo diga o no el cuerpo, y un 429
  // del rate limiter no pasa por el controlador que pone el código.
  if (error.status === 410) return 'replan'
  if (error.status === 429) return 'rateLimited'
  if (error.code === undefined) return 'none'
  return ACTION_BY_CODE.get(error.code) ?? 'none'
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
  replan: 'El plan ya no es válido (expiró, ya se ejecutó, o el origen cambió). Creá un plan nuevo para continuar.',
  forceQuarantine:
    'El destino está en cuarentena. Solo si ya lo inspeccionaste, reintentá forzando la operación.',
  recomputeToken:
    'El plan cambió desde la última vista previa; se recomputará automáticamente el token.',
  switchToExistingTarget: "La BD destino ya existe: cambiá el modo a 'existing' para usarla.",
  switchToNewTarget: "La BD destino no existe: cambiá el modo a 'new' para crearla.",
  rateLimited: 'Se alcanzó el límite de solicitudes. Esperá unos segundos y volvé a intentarlo.',
}
