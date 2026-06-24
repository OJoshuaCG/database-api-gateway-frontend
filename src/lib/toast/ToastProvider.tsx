import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ToastContext, type Toast, type ToastInput, type ToastVariant } from './toast-context'

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-success/40 text-foreground',
  error: 'border-error/50 text-foreground',
  info: 'border-primary/40 text-foreground',
  warning: 'border-warning/50 text-foreground',
}

const VARIANT_DOT: Record<ToastVariant, string> = {
  success: 'bg-success',
  error: 'bg-error',
  info: 'bg-primary',
  warning: 'bg-warning',
}

const DEFAULT_DURATION = 5000

let counter = 0
function nextId(): string {
  counter += 1
  return `toast-${counter}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId()
      const toast: Toast = {
        id,
        variant: input.variant ?? 'info',
        title: input.title,
        description: input.description,
      }
      setToasts((prev) => [...prev, toast])
      const duration = input.duration ?? DEFAULT_DURATION
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      }
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title: string, description?: string) =>
        push({ variant: 'success', title, description }),
      error: (title: string, description?: string) =>
        push({ variant: 'error', title, description, duration: 8000 }),
    }),
    [toasts, push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-elevated',
              VARIANT_STYLES[toast.variant],
            )}
          >
            <span
              aria-hidden
              className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', VARIANT_DOT[toast.variant])}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Cerrar notificación"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor">
                <path d="M6 6l8 8M14 6l-8 8" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
