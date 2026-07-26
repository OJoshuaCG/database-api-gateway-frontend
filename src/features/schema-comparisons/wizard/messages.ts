import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores del asistente de comparación de esquemas a una ACCIÓN accionable
 * (§ Matriz de errores del documento de referencia). El backend no expone un código de razón
 * estructurado para 409/422 (siempre `type: "AppHttpException"`), así que se reconoce la
 * variante por fragmentos ESTABLES del `detail.msg` documentado — con un `default` que nunca
 * rompe: si el texto no calza con ningún patrón conocido, se trata como un error genérico y se
 * muestra igual el `detail.msg` real (nunca se oculta información al usuario).
 */

export type ComparisonErrorAction =
  | 'recalculate'
  | 'switchToAdopt'
  | 'switchToExecute'
  | 'forceQuarantine'
  | 'fixConfirmName'
  | 'recomputeToken'
  | 'resolveDependencies'
  | 'rateLimited'
  | 'none'

const MESSAGE_PATTERNS: [RegExp, ComparisonErrorAction][] = [
  [/cambió desde que se calculó/i, 'recalculate'],
  [/expiró/i, 'recalculate'],
  [/tiene un blueprint asignado/i, 'switchToAdopt'],
  [/no tiene blueprint asignado/i, 'switchToExecute'],
  // Addendum "referencias crudas": target sin registrar en el inventario (adopt 422 distinto
  // del "sin blueprint" de arriba) — misma acción de recuperación (usar Opción B).
  [/no está en el inventario del gateway/i, 'switchToExecute'],
  [/cuarentena/i, 'forceQuarantine'],
  [/nombre de confirmación no coincide/i, 'fixConfirmName'],
  [/token de confirmación no coincide/i, 'recomputeToken'],
]

/** Clasifica un `ApiError` del flujo de comparación en una acción de UI recomendada. */
export function classifyComparisonError(error: ApiError): ComparisonErrorAction {
  if (error.status === 410) return 'recalculate'
  if (error.status === 429) return 'rateLimited'
  // 422 "la selección no cierra sus dependencias" (§10.6): a diferencia del resto, este SÍ trae
  // contexto estructurado (`public_context.missing_dependencies` / `suggested_item_ids`), así que
  // se reconoce por dato y no por fragmento de texto.
  if (
    error.status === 422 &&
    (error.suggestedItemIds?.length || error.missingDependencies?.length)
  ) {
    return 'resolveDependencies'
  }
  for (const [pattern, action] of MESSAGE_PATTERNS) {
    if (pattern.test(error.message)) return action
  }
  return 'none'
}

export const ACTION_LABELS: Record<ComparisonErrorAction, string | null> = {
  recalculate: 'Recalcular',
  switchToAdopt: 'Ir a «Adoptar como versión»',
  switchToExecute: 'Ir a «Ejecutar sobre el target»',
  forceQuarantine: 'Reintentar con force',
  fixConfirmName: null,
  recomputeToken: 'Recomputar vista previa',
  resolveDependencies: 'Resolver automáticamente',
  rateLimited: null,
  none: null,
}

/** Texto de apoyo (bajo el mensaje del backend) para las acciones que lo necesitan. */
export const ACTION_HINTS: Partial<Record<ComparisonErrorAction, string>> = {
  recalculate: 'El estado de origen/target cambió; vuelve a calcular la comparación para continuar.',
  switchToAdopt: 'El target tiene un blueprint asignado: adopta el diff como una nueva versión en vez de ejecutarlo directo.',
  switchToExecute: 'El target no tiene blueprint: ejecuta el diff directamente en vez de adoptarlo como versión.',
  forceQuarantine: 'El target está en cuarentena. Solo si ya lo inspeccionaste, reintenta forzando la operación.',
  recomputeToken: 'El conjunto de sentencias a ejecutar cambió desde la última vista previa; se recomputará automáticamente.',
  resolveDependencies:
    'Tu selección depende de sentencias que no incluiste. Se agregarán las sugeridas por el backend a la selección; revisa y vuelve a confirmar.',
  rateLimited: 'Se alcanzó el límite de solicitudes. Espera unos segundos e inténtalo de nuevo.',
}
