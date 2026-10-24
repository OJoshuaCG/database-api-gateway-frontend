import type { ChannelReference, ChannelResolutionOut } from '@/lib/contracts'

/**
 * ¿Mover un canal de `current` a `target` es un RETROCESO?
 *
 * Las versiones son dígitos de ancho variable y se comparan por valor NUMÉRICO (`'10'` es posterior
 * a `'9'`), igual que en `database-models/version-nav`. Si alguna no es numérica no se puede
 * afirmar que sea un retroceso y se devuelve `false`: es solo una pista de UI para pedir la
 * confirmación por adelantado, y el servidor sigue siendo quien decide (devuelve 409
 * `promote_backward_requires_confirm`, que el diálogo también atiende).
 */
export function isBackwardPromotion(
  current: string | null | undefined,
  target: string | null | undefined,
): boolean {
  if (!current || !target) return false
  const currentNumber = Number(current)
  const targetNumber = Number(target)
  if (Number.isNaN(currentNumber) || Number.isNaN(targetNumber)) return false
  return targetNumber < currentNumber
}

/**
 * La versión CALCULADA (mínimo de las bases vivas de un entorno) de un canal, en la misma forma
 * sea cual sea el modo.
 *
 * En un canal `derived` ES la resolución; en uno `manual` o `latest` con entorno viene aparte en
 * `derived_reference` y se muestra junto al puntero como REFERENCIA, nunca en su lugar. Sin
 * entorno no hay nada que calcular y devuelve `null`.
 */
export function derivedReferenceOf(resolution: ChannelResolutionOut): ChannelReference | null {
  if (resolution.resolution_mode === 'derived') {
    return {
      environment_slug: resolution.environment_slug,
      resolved: resolution.resolved,
      code: resolution.code,
      version: resolution.version,
      model_migration_id: resolution.model_migration_id,
      source: resolution.source,
      databases: resolution.databases,
    }
  }
  return resolution.derived_reference ?? null
}
