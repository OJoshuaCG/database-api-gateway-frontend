import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

/**
 * Cabecera consistente para cada página (jerarquía Material, espaciado uniforme).
 *
 * Las acciones NO llevan `shrink-0`: con las dos o tres de siempre daba igual, pero una ficha con
 * ocho aplastaba el título hasta una columna de letras y desbordaba la página en portátiles. Ahora
 * las acciones se parten en líneas (`flex-wrap` + `min-w-0`) y el título ocupa el resto con un
 * mínimo (`sm:min-w-48`) que impide que las acciones lo dejen en nada; `break-words` corta los
 * nombres físicos largos sin espacios (`tienda_produccion_2024_…`). Con pocas acciones, el
 * reparto es el de antes: título a la izquierda, acciones a la derecha.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1 break-words sm:min-w-48 sm:flex-1">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
    </div>
  )
}
