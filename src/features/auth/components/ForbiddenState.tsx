import { Link } from 'react-router-dom'
import { BanIcon } from '@/components/ui'
import { forbiddenCopy } from '../messages'

interface ForbiddenStateProps {
  /** Reemplaza el título genérico cuando la pantalla sabe qué se intentó («Usuarios del gateway»). */
  title?: string
}

/**
 * Estado de página para un 403 `access.forbidden`: el reemplazo de `ErrorState` cuando lo que
 * falló es el acceso, no la red.
 *
 * **Sin «Reintentar», a propósito.** El mismo request con el mismo acceso da el mismo 403, así que
 * ofrecerlo entrena a apretar un botón que nunca funciona. La salida es «Ver mi acceso».
 */
export function ForbiddenState({ title }: ForbiddenStateProps) {
  const copy = forbiddenCopy()
  return (
    // `status`, no `alert`: es el contenido de la página, no un aviso urgente que interrumpa al
    // lector de pantalla.
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface-muted px-6 py-10 text-center"
    >
      <span className="text-muted-foreground">
        <BanIcon className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title ?? copy.title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{copy.body}</p>
      </div>
      <Link
        to={copy.actionTo}
        className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copy.actionLabel}
      </Link>
    </div>
  )
}
