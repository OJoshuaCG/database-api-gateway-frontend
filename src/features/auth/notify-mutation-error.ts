import { toApiError } from '@/lib/api/errors'
import type { ToastContextValue } from '@/lib/toast/toast-context'
import { forbiddenCopy, isAccessForbidden } from './messages'

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
  toast.error(title, description ?? toApiError(error).message)
}
