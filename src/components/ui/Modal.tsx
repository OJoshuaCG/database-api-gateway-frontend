import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  /** Visor a pantalla casi completa (`CodeBlock` expandido); el alto lo fija el contenido. */
  full: 'max-w-[min(96rem,95vw)]',
}

/**
 * Diálogo modal accesible basado en el elemento nativo `<dialog>`, que aporta
 * focus-trap, cierre con Esc y backdrop de forma estándar.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClose={onClose}
      onCancel={(event) => {
        // El `<dialog>` nativo se cierra solo al recibir `cancel` (Esc). Eso saltaría por
        // encima de React: si el padre ignora `onClose` —p. ej. mientras hay una operación
        // irreversible en vuelo—, la prop `open` seguiría en `true`, el efecto de arriba no
        // volvería a ejecutarse y el diálogo quedaría cerrado en el DOM e inalcanzable.
        // Cancelando el evento, quien decide si se cierra es siempre el padre.
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Cerrar al hacer clic en el backdrop (fuera del contenido).
        if (event.target === ref.current) onClose()
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-card border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-overlay',
        SIZES[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-0">
        <div className="flex flex-col gap-1">
          <h2 id="modal-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor">
            <path d="M6 6l8 8M14 6l-8 8" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {/* `min-w-0`: el visor a pantalla completa mete aquí el SQL más ancho de la app y no debe
          poder empujar el panel más allá de su `max-w`. */}
      <div className="min-w-0 p-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-border p-5">
          {footer}
        </div>
      )}
    </dialog>
  )
}
