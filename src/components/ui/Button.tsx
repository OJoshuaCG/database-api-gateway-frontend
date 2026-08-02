import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'danger-soft'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

/*
 * Regla de los estados hover, y el porqué:
 *
 * Las filas de tabla se resaltan al pasar el ratón con un tinte NEUTRO (`bg-surface-muted`).
 * `outline` y `ghost` usaban ese mismo token para su propio hover, así que dentro de una fila
 * resaltada el botón no cambiaba nada al apuntarlo —y en `outline`, que en reposo tiene fondo
 * propio, el efecto se invertía: al pasar por encima adoptaba el color de la fila y se camuflaba.
 *
 * Por eso los controles se resaltan con un tinte de ACENTO, no neutro: al ser un tono distinto
 * no pueden colisionar con el fondo de la fila esté donde esté el botón. El tinte va con alfa,
 * así que compone sobre cualquier superficie y funciona igual en claro y en oscuro.
 *
 * Invariante: ningún hover de control debe usar `bg-surface-muted`.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
  outline:
    'border border-input bg-surface text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary',
  ghost:
    'border border-border/70 text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary',
  danger: 'bg-error text-error-foreground hover:bg-error/90',
  'danger-soft':
    'border border-error/30 bg-error/5 text-error hover:border-error/60 hover:bg-error/15',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-8 gap-1.5 px-3 py-1.5 text-sm',
  md: 'min-h-10 gap-2 px-4 py-2 text-sm',
  lg: 'min-h-11 gap-2 px-5 py-2.5 text-base',
  /*
   * Los tamaños de icono NO fijan alto ni ancho: declaran el mismo alto mínimo y el mismo
   * relleno horizontal que su equivalente con texto (`icon`↔`md`, `icon-sm`↔`sm`).
   *
   * Del alto: un botón de texto con borde (`ghost`/`outline`) mide 2 px más que su `min-h`
   * —la caja incluye el borde—, así que con una altura fija los iconos quedaban más bajos que
   * sus vecinos. Con `min-h`, el `align-items: stretch` de los contenedores flex los iguala sin
   * depender de aritmética; donde no hay estirado, caen al mínimo.
   *
   * Del ancho: con un ancho fijo y estrecho parecían rendijas al lado de botones con palabras.
   * Compartiendo el `px` la fila entera lleva el mismo ritmo horizontal.
   */
  icon: 'min-h-10 px-4',
  'icon-sm': 'min-h-8 px-3',
}

/** Tamaños sin texto: el spinner de carga los SUSTITUYE en vez de sumarse (no cabrían los dos). */
const ICON_ONLY_SIZES = new Set<ButtonSize>(['icon', 'icon-sm'])

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

/**
 * Botón accesible. El foco visible se garantiza por el ring (color de token `ring`).
 * No usa neumorphism (rompería el contraste de un control interactivo).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading = false, disabled, className, children, ...props },
  ref,
) {
  const iconOnly = ICON_ONLY_SIZES.has(size)
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg text-center font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Spinner className={cn('h-4 w-4', !iconOnly && 'mr-2')} />}
      {!(iconOnly && isLoading) && children}
    </button>
  )
})
