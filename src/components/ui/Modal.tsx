import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
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
      onCancel={onClose}
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
      <div className="p-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-border p-5">
          {footer}
        </div>
      )}
    </dialog>
  )
}
