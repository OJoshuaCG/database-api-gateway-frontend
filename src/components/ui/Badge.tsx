import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'error' | 'warning' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted-foreground border-border',
  primary: 'bg-primary/10 text-primary border-primary/30',
  success: 'bg-success/10 text-success border-success/30',
  error: 'bg-error/10 text-error border-error/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  info: 'bg-primary/10 text-primary border-primary/30',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  /**
   * Matiz para el hover con puntero, y NADA más. Va en un `<span>` no interactivo: **no llega a
   * los lectores de pantalla** (no es nombre accesible ni se enfoca con teclado) y **en táctil no
   * existe**. Por eso aquí solo cabe lo redundante —una definición que el `label` ya insinúa, un
   * valor completo que se ve recortado—, nunca lo que decide algo: el motivo de un bloqueo, un
   * riesgo o la consecuencia de un estado van visibles, en un `Callout`, en texto al lado o en una
   * `StatusLegend` bajo la tabla.
   */
  title?: string
}

/**
 * Etiqueta de estado. Los colores de texto usan la variante a contraste suficiente del
 * token; el fondo es una versión translúcida del mismo token.
 */
export function Badge({ tone = 'neutral', children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
