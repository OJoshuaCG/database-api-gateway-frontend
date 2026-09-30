import type { ToastContextValue } from '@/lib/toast/toast-context'
import { toApiError } from '@/lib/api/errors'

/**
 * Texto para una operación de migración cuya respuesta no llegó (504 o la página de un proxy).
 *
 * Apply, rollback, `reconcile-partial` y el apply masivo son síncronos y pueden tardar más que el
 * timeout de un proxy. Cuando el proxy corta, uvicorn **sigue** ejecutando la request: decir «No
 * se pudieron aplicar las migraciones» es falso y, peor, invita a relanzar sobre una base que
 * puede estar a medio migrar. Se dice lo que se sabe —que probablemente sigue— y se deja que el
 * refetch de `GET .../migrations/status` (disparado por la invalidación) cuente cómo terminó.
 */
export const UNCERTAIN_RUN_DESCRIPTION =
  'La operación probablemente sigue en curso en el servidor; consultando el estado… No la vuelvas a lanzar hasta ver cómo terminó.'

/**
 * Si el error es de resultado incierto (`ApiError.isOutcomeUncertain`), avisa con tono de
 * advertencia, invalida lo que diga cómo terminó y devuelve `true`: el llamador ya no debe
 * pintar su toast de fallo. Con cualquier otro error devuelve `false` y no hace nada.
 *
 * Un solo sitio para las cuatro mutaciones, para que ninguna vuelva a decir «no se pudo» ante un
 * timeout mientras las demás ya no lo dicen.
 */
export function handleUncertainRun(
  error: unknown,
  toast: Pick<ToastContextValue, 'push'>,
  title: string,
  invalidate: () => void,
): boolean {
  if (!toApiError(error).isOutcomeUncertain) return false
  invalidate()
  toast.push({ variant: 'warning', title, description: UNCERTAIN_RUN_DESCRIPTION })
  return true
}
