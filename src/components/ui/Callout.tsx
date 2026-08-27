import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Banda de aviso con tono.
 *
 * **Nació en `features/database-exports`** —que tiene ocho bandas distintas que el contrato exige
 * mostrar— y vive acá desde que las versiones de blueprint necesitaron las suyas: `⚠ SQL editado
 * tras aplicarse` y `SQL congelado` son avisos con consecuencia (uno dice que hay bases con el
 * esquema anterior, el otro que editar el SQL pide confirmación explícita) y hasta ahora se
 * escondían en el `title` de un `Badge`, que no es nombre accesible y en táctil no existe.
 *
 * La regla que este componente encarna, y que estaba escrita en su versión original:
 * **va como banda y no como tooltip a propósito, porque un tooltip se descubre por accidente y
 * esto tiene que leerse antes de decidir.** Si un aviso decide algo, va en un `Callout`; si es
 * accesorio, puede quedarse en un `title`.
 *
 * Los colores salen solo de tokens del tema; nunca hex ni rgb.
 */
export type CalloutTone = 'info' | 'warning' | 'danger' | 'success'

const TONE_CLASSES: Record<CalloutTone, string> = {
  info: 'border-primary/30 bg-primary/10 text-foreground',
  warning: 'border-warning/30 bg-warning/10 text-foreground',
  danger: 'border-error/40 bg-error/10 text-foreground',
  success: 'border-success/30 bg-success/10 text-foreground',
}

const TITLE_CLASSES: Record<CalloutTone, string> = {
  info: 'text-primary',
  warning: 'text-warning',
  danger: 'text-error',
  success: 'text-success',
}

interface CalloutProps {
  tone: CalloutTone
  title: string
  children?: ReactNode
  /** Acción de recuperación, cuando el aviso tiene una salida concreta que ofrecer. */
  action?: ReactNode
  className?: string
}

export function Callout({ tone, title, children, action, className }: CalloutProps) {
  return (
    <div
      // `role="alert"` solo en lo que exige atención inmediata: un `info` permanente anunciado como
      // alerta convierte al lector de pantalla en ruido de fondo y se deja de escuchar.
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-card border px-4 py-3 text-sm',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <p className={cn('font-semibold', TITLE_CLASSES[tone])}>{title}</p>
      {children ? (
        <div className="flex flex-col gap-1 text-muted-foreground">{children}</div>
      ) : null}
      {action ? <div className="flex flex-wrap gap-2 pt-1">{action}</div> : null}
    </div>
  )
}
