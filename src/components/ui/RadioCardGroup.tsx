import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface RadioCardOption<T extends string> {
  value: T
  label: string
  /** Texto de apoyo bajo el label. `ReactNode` porque a veces lleva `<code>` o datos interpolados. */
  hint?: ReactNode
  disabled?: boolean
}

export interface RadioCardGroupProps<T extends string> {
  /** Título del grupo. Se renderiza como `<legend>` → es el nombre accesible del grupo. */
  title: string
  /** Instrucción de qué hacer en este grupo. */
  description?: ReactNode
  options: readonly RadioCardOption<T>[]
  /** `null` = ningún radio marcado. */
  value: T | null
  onChange: (value: T) => void
  /** Columnas a partir de `sm:`. En móvil siempre 1. */
  columns?: 1 | 2 | 3
  /** `name` del grupo. Por defecto uno único vía `useId`. */
  name?: string
  className?: string
}

/** Clases estáticas: Tailwind no ve strings construidos dinámicamente. */
const COLUMN_CLASSES: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
}

/**
 * Grupo de radio-cards mutuamente excluyentes: UNA opción por grupo. Cada grupo es un `<fieldset>`
 * con `<legend>` visible y borde propio, para que cuando haya VARIOS grupos en la misma pantalla se
 * lea que hay que elegir una opción en cada uno (y no una entre todas). Navegación con flechas y
 * roving tabindex son nativos del grupo de radios (mismo `name`).
 */
export function RadioCardGroup<T extends string>({
  title,
  description,
  options,
  value,
  onChange,
  columns = 2,
  name,
  className,
}: RadioCardGroupProps<T>) {
  const generatedId = useId()
  const groupName = name ?? generatedId
  const descriptionId = `${generatedId}-description`

  return (
    <fieldset className={cn('min-w-0 rounded-lg border border-border p-4', className)}>
      <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      <div className="flex flex-col gap-3">
        {description && (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
        <div className={cn('grid gap-2', COLUMN_CLASSES[columns])}>
          {options.map((option) => {
            const optionId = `${groupName}-${option.value}`
            const hintId = `${optionId}-hint`
            const checked = value === option.value
            const describedBy = [option.hint ? hintId : null, description ? descriptionId : null]
              .filter(Boolean)
              .join(' ')

            return (
              <label
                key={option.value}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  option.disabled
                    ? 'cursor-not-allowed border-border opacity-60'
                    : checked
                      ? 'cursor-pointer border-primary bg-primary/5'
                      : 'cursor-pointer border-border hover:bg-surface-muted',
                )}
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <input
                    type="radio"
                    id={optionId}
                    name={groupName}
                    className="accent-primary"
                    checked={checked}
                    disabled={option.disabled}
                    aria-describedby={describedBy || undefined}
                    onChange={() => onChange(option.value)}
                  />
                  {option.label}
                </span>
                {option.hint && (
                  <span id={hintId} className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </div>
    </fieldset>
  )
}
