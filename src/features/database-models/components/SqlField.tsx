import { useId, useState } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { Button, CodeBlock, CodeIcon, PencilIcon, Textarea } from '@/components/ui'

interface SqlFieldProps {
  label: string
  /** Valor actual del campo (vía `watch`): es lo que se resalta en la vista con formato. */
  value: string
  /** El `{...register('campo')}` del formulario. */
  registration: UseFormRegisterReturn
  hint?: string
  error?: string
  required?: boolean
  /** Sin edición posible: se muestra siempre con formato y sin conmutador. */
  readOnly?: boolean
  rows?: number
  emptyLabel?: string
}

/**
 * Campo de SQL editable que se puede ver **con formato**.
 *
 * El SQL de una versión de blueprint se escribe en un `<textarea>`, así que era lo único del
 * módulo que se leía en gris plano: los bloques traducidos por motor, justo debajo, ya salían
 * resaltados y con copiar y pantalla completa. Aquí se conmuta entre las dos vistas en vez de
 * elegir una: editar necesita un textarea de verdad, y leer necesita colores, numeración de
 * líneas y poder ampliar.
 *
 * Arranca en la vista con formato cuando ya hay SQL —el caso normal al abrir una versión— y en
 * edición cuando está vacío, que es cuando se está creando. Al conmutar se desmonta el textarea,
 * pero el valor sobrevive: el formulario no usa `shouldUnregister`.
 */
export function SqlField({
  label,
  value,
  registration,
  hint,
  error,
  required,
  readOnly,
  rows = 6,
  emptyLabel,
}: SqlFieldProps) {
  const [editing, setEditing] = useState(() => !readOnly && value.trim().length === 0)
  const id = useId()
  const showEditor = editing && !readOnly

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </label>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setEditing((previous) => !previous)}
          >
            {showEditor ? <CodeIcon /> : <PencilIcon />}
            {showEditor ? 'Ver con formato' : 'Editar'}
          </Button>
        )}
      </div>

      {showEditor ? (
        <Textarea id={id} rows={rows} className="font-mono text-xs" {...registration} />
      ) : (
        <CodeBlock code={value} emptyLabel={emptyLabel ?? 'Sin SQL.'} maxHeightClass="max-h-96" />
      )}

      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
