import { toApiError } from '@/lib/api/errors'
import type { ToastContextValue } from '@/lib/toast/toast-context'
import { CSRF_ERROR_TITLE, csrfErrorCopy, forbiddenCopy, isAccessForbidden } from './messages'

/**
 * El toast de una mutación que falló. **Único punto** donde un 403 `access.forbidden` se convierte
 * en mensaje, para que toda la app diga lo mismo ante el mismo rechazo.
 *
 * Antes cada hook pintaba su «No se pudo …» con el `msg` del backend («No tienes permiso para esta
 * operación.», en tú y sin salida). Con este helper:
 *
 * - un 403 de acceso muestra el copy compartido (`forbiddenCopy()`) con el enlace «Ver mi acceso»,
 *   y se descarta el título del hook: «No se pudieron aplicar las migraciones» invita a reintentar,
 *   y el mismo pedido con el mismo acceso da el mismo 403;
 * - un 403 de CSRF (`auth.csrf_missing`/`auth.csrf_invalid`/`auth.origin_rejected`) muestra su
 *   propio copy (`csrfErrorCopy`), que manda a recargar. Mismo status que el de acceso, otra causa:
 *   es un fallo del cliente y no de permisos, así que ni «Ver mi acceso» ni el título del hook
 *   sirven. Se registra en consola, porque en una SPA sana no debería pasar;
 * - cualquier otro error, el título del hook y la descripción que traiga (o el `msg` del backend).
 *
 * `toast` va por parámetro y no con `useToast()` adentro: se llama desde `onError`, fuera del render.
 */
export function notifyMutationError(
  toast: Pick<ToastContextValue, 'error' | 'push'>,
  error: unknown,
  title: string,
  description?: string,
): void {
  if (isAccessForbidden(error)) {
    const copy = forbiddenCopy()
    toast.push({
      variant: 'error',
      title: copy.title,
      description: copy.body,
      action: { label: copy.actionLabel, href: copy.actionTo },
      duration: 10_000,
    })
    return
  }
  const apiError = toApiError(error)
  const csrfCopy = csrfErrorCopy(apiError)
  if (csrfCopy) {
    console.warn('[auth] El backend rechazó la mutación por CSRF:', {
      code: apiError.code,
      requestId: apiError.requestId,
    })
    toast.push({
      variant: 'error',
      title: CSRF_ERROR_TITLE,
      description: csrfCopy,
      duration: 10_000,
    })
    return
  }
  toast.error(title, description ?? apiError.message)
}
