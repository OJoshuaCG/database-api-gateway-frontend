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
}

/**
 * Etiqueta de estado. Los colores de texto usan la variante a contraste suficiente del
 * token; el fondo es una versión translúcida del mismo token.
 */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
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
