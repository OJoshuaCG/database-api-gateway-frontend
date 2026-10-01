import { cn } from '@/lib/utils'
import type { CapabilityGuard } from '../hooks/use-capability-guard'

/**
 * El motivo VISIBLE de un control deshabilitado por capacidad, con el `id` que el control
 * referencia por `aria-describedby`. Nada cuando está permitido. Nunca va en un `title`: no llega
 * a un lector de pantalla ni existe en táctil.
 */
export function CapabilityHint({
  guard,
  className,
}: {
  guard: CapabilityGuard
  className?: string
}) {
  if (guard.allowed || !guard.hint) return null
  return (
    <p id={guard.hintId} className={cn('text-xs text-muted-foreground', className)}>
      {guard.hint}
    </p>
  )
}
