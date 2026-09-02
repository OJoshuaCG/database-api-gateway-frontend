import { useId, useState } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { CodeBlock, ExpandIcon, IconButton, Modal, SqlEditor } from '@/components/ui'
import { cn } from '@/lib/utils'

interface SqlFieldProps {
  /** Opcional: si el contenedor ya pone su propia etiqueta, se omite para no duplicarla. */
  label?: string
  /** Valor actual del campo (vía `watch`): es lo que se resalta. */
  value: string
  /** El `{...register('campo')}` del formulario. */
  registration: UseFormRegisterReturn
  hint?: string
  error?: string
  required?: boolean
  /** Sin edición posible: se muestra con el visor de solo lectura. */
  readOnly?: boolean
  /** Alto de partida —y mínimo— en líneas. */
  rows?: number
  /** Tope al que puede crecer el campo con el contenido. Ver `SqlEditor`. */
  maxRows?: number
  emptyLabel?: string
}

/**
 * Campo de SQL de un formulario, **resaltado también mientras se edita**.
 *
 * No hay modo «editar» y modo «ver»: se escribe sobre el propio SQL coloreado (`SqlEditor`
 * superpone el textarea real, transparente, sobre la capa resaltada). Alternar entre dos vistas
 * obligaba a perder el color justo cuando más se necesita —al escribir es cuando se cometen los
 * errores de sintaxis—, así que se eliminó el conmutador.
 *
 * Cuando el campo es de solo lectura se usa directamente el visor `CodeBlock`, que ya trae
 * copiar y pantalla completa: si no se puede editar, no hay motivo para montar un textarea.
 *
 * El alto **acompaña al contenido**: `rows` es el punto de partida y el campo crece hasta
 * `maxRows`, que es un tope pensado para la pantalla, no para el contenido. Es el equivalente
 * editable del tirador de alto del `CodeBlock`, que es lo que se ve cuando el mismo SQL se
 * muestra en modo lectura.
 */
export function SqlField({
  label,
  value,
  registration,
  hint,
  error,
  required,
  readOnly,
  rows = 12,
  /*
   * Techo del crecimiento: el campo acompaña a lo que se escribe, pero **hasta aquí**. Un DDL de
   * mil líneas no puede convertir el campo en la página entera; pasado el tope, desplaza. 40
   * líneas son ~51rem (≈820 px): un editor donde se lee y se corrige SQL de verdad sin pelear con
   * una mirilla. Para revisar el archivo completo de un vistazo está el visor a pantalla completa
   * que ya trae la barra.
   *
   * El tope solo mira el ALTO. El ancho no depende de él: la caja del editor lo hereda del
   * formulario y nunca lo empuja (ver `SqlEditor`), así que subirlo no puede sacar scroll
   * horizontal a la vista.
   */
  maxRows = 40,
  emptyLabel,
}: SqlFieldProps) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()

  if (readOnly) {
    return (
      <div className="flex flex-col gap-1.5">
        <CodeBlock title={label} code={value} emptyLabel={emptyLabel ?? 'Sin SQL.'} />
        {error ? (
          <p className="text-xs text-error">{error}</p>
        ) : (
          hint && <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('flex flex-wrap items-center gap-2', !label && 'justify-end')}>
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <IconButton
          label="Ver a pantalla completa"
          icon={<ExpandIcon />}
          className="ml-auto"
          onClick={() => setExpanded(true)}
        />
      </div>

      <SqlEditor id={id} value={value} rows={rows} maxRows={maxRows} {...registration} />

      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}

      {/* A pantalla completa se muestra en modo lectura: montar un segundo textarea registrado
          al mismo campo dejaría a react-hook-form con dos referencias para un solo valor. */}
      {expanded && (
        <Modal
          open
          onClose={() => setExpanded(false)}
          title={label ?? 'SQL'}
          description="Solo lectura. Para editar, cierra y vuelve al formulario."
          size="full"
        >
          <CodeBlock
            code={value}
            emptyLabel={emptyLabel ?? 'Sin SQL.'}
            maxHeightClass="max-h-[calc(100dvh-16rem)]"
            hideFullscreen
          />
        </Modal>
      )}
    </div>
  )
}
