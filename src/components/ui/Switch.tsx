import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
  hint?: string
  disabled?: boolean
  id?: string
  /**
   * Nombre accesible del botón cuando no hay `label` visible (ej. una columna de tabla que ya
   * identifica la fila con texto). Si se omite y tampoco hay `label`, el switch queda sin nombre
   * accesible para lectores de pantalla.
   */
  ariaLabel?: string
}

/** Interruptor accesible (role="switch") para flags booleanos como `provision`. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  id,
  ariaLabel,
}: SwitchProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const hintId = `${fieldId}-hint`

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        id={fieldId}
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-surface shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
      {(label || hint) && (
        <div className="flex flex-col">
          {label && (
            <label htmlFor={fieldId} className="cursor-pointer text-sm font-medium text-foreground">
              {label}
            </label>
          )}
          {hint && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
