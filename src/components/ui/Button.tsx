import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
  outline: 'border border-input bg-surface text-foreground hover:bg-surface-muted',
  ghost: 'text-foreground hover:bg-surface-muted',
  danger: 'bg-error text-error-foreground hover:bg-error/90',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-base',
  icon: 'h-10 w-10',
}

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
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Spinner className="mr-2 h-4 w-4" />}
      {children}
    </button>
  )
})
