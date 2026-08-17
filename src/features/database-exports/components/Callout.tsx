import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Banda de aviso con tono. No existe un componente compartido para esto —el resto del repo inlinea
 * el `div`— pero esta feature tiene ocho bandas distintas que el contrato exige mostrar (extracción
 * en claro, consistencia asimétrica del motor, `.zip` implícito, entrega en línea no viable, esquema
 * cambiado durante la corrida, artefacto parcial, garantías degradadas y los avisos de la matriz).
 * Repetir el mismo `div` ocho veces con clases a mano es donde se cuela la banda roja que debía ser
 * ámbar — y en esta pantalla el color ES la información.
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

/**
 * Lista de avisos del preview. **Se muestran todos, no solo el primero**: ahí viven a la vez el
 * aviso de consistencia del motor, las tablas sin clave primaria, el `.zip` implícito y los filtros
 * `where` definidos para tablas que no están en la selección de datos. Quedarse con el primero
 * esconde exactamente el que el operador necesitaba leer.
 */
export function WarningList({ warnings, title }: { warnings: readonly string[]; title: string }) {
  if (warnings.length === 0) return null
  return (
    <Callout tone="warning" title={title}>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {/* La `key` lleva el índice porque el backend puede repetir un aviso literal (dos tablas sin
            clave primaria dan el mismo texto) y una key duplicada reconcilia mal. */}
        {warnings.map((warning, index) => (
          <li key={`${index}:${warning}`}>{warning}</li>
        ))}
      </ul>
    </Callout>
  )
}

/**
 * Banda permanente sobre la naturaleza de la operación. El módulo **no tiene enmascarado de datos**:
 * lo que sale, sale en claro. No es un descuido, es un alcance decidido, y los controles
 * compensatorios son la confirmación de doble factor, el TTL corto, la descarga de un solo uso y
 * sobre todo la auditoría de cada descarga.
 *
 * Va como banda y no como tooltip a propósito: un tooltip se descubre por accidente, y esto tiene
 * que leerse antes de decidir.
 */
export function PlainDataNotice({ className }: { className?: string }) {
  return (
    <Callout
      tone="info"
      title="Esta exportación extrae los datos sin enmascarar"
      className={className}
    >
      <p>
        El artefacto contiene los valores reales en claro. Cada descarga queda registrada en la
        auditoría del gateway.
      </p>
    </Callout>
  )
}
