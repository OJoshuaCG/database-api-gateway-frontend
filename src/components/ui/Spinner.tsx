import { cn } from '@/lib/utils'

interface SpinnerProps {
  className?: string
  label?: string
}

/** Indicador de carga accesible (anuncia "Cargando" a lectores de pantalla). */
export function Spinner({ className, label = 'Cargando' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <svg
        className={cn('h-5 w-5 animate-spin text-current', className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          className="opacity-25"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="opacity-90"
        />
      </svg>
    </span>
  )
}

/** Spinner centrado a pantalla completa (bootstrap de sesión, etc.). */
export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      <Spinner className="h-8 w-8" label={label} />
    </div>
  )
}
