import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'
import { BUTTON_BASE, SIZES, VARIANTS, type ButtonSize, type ButtonVariant } from './button-styles'

export type { ButtonSize, ButtonVariant } from './button-styles'

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
        BUTTON_BASE,
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
