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

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
  outline: 'border border-input bg-surface text-foreground hover:bg-surface-muted',
  ghost: 'border border-border/70 text-foreground hover:border-border hover:bg-surface-muted',
  danger: 'bg-error text-error-foreground hover:bg-error/90',
  'danger-soft': 'border border-error/30 bg-error/5 text-error hover:bg-error/10 hover:border-error/50',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-8 gap-1.5 px-3 py-1.5 text-sm',
  md: 'min-h-10 gap-2 px-4 py-2 text-sm',
  lg: 'min-h-11 gap-2 px-5 py-2.5 text-base',
  icon: 'h-10 w-10',
  /** Alto de `sm` (32 px) en formato cuadrado: para acciones de fila, que no deben engordarla. */
  'icon-sm': 'h-8 w-8',
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
