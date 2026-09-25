import type { ReactNode } from 'react'
import { Button, type ButtonVariant } from './Button'

/**
 * Nombre accesible de una acción de fila: empieza por el texto visible (WCAG 2.5.3, para que
 * quien dicta «pulsa Quitar del inventario» acierte) y le suma la fila. Sin la fila, un lector de
 * pantalla oye «Quitar del inventario, botón» veinticinco veces seguidas y no sabe cuál es cuál.
 *
 * El 🔌 no se lee: los lectores lo anuncian como «enchufe», que no dice nada. Se reemplaza por lo
 * que significa.
 */
function rowActionName(visibleText: string, subject: string): string {
  return `${visibleText.replace(/\s*🔌/u, ' (toca el motor)')} «${subject}»`
}

export interface RowActionButtonProps {
  /** Texto de la acción: tooltip, texto visible donde se muestra y comienzo del nombre accesible. */
  label: string
  /** La fila sobre la que actúa (nombre de la base, `usuario@host`…). */
  subject: string
  onClick: () => void
  variant?: ButtonVariant
  /** Sin icono, el botón va con texto. */
  icon?: ReactNode
  /**
   * Con icono: `table` lo deja solo en icono siempre; `card` muestra además el texto en la vista
   * de tarjeta (`< md`), donde no hay tooltip y dos botones rojos solo se distinguen por la forma.
   * Es para las acciones que NO están en la lista de iconos universales de `CLAUDE.md` (editar,
   * eliminar, actualizar, copiar, navegar, ver/ocultar).
   */
  iconText?: 'table' | 'card'
  isLoading?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Botón de una acción de fila (`DataTable` o tablas propias). Resuelve en un solo sitio las tres
 * cosas que cada fila hacía a su manera: el nombre accesible con contexto, el tamaño compartido
 * con `sm` y el texto que el táctil necesita donde el icono solo no alcanza.
 */
export function RowActionButton({
  label,
  subject,
  onClick,
  variant = 'ghost',
  icon,
  iconText = 'table',
  isLoading,
  disabled,
  className,
}: RowActionButtonProps) {
  const common = {
    variant,
    onClick,
    isLoading,
    disabled,
    className,
    'aria-label': rowActionName(label, subject),
  }
  if (!icon) {
    return (
      <Button size="sm" {...common}>
        {label}
      </Button>
    )
  }
  if (iconText === 'card') {
    // `sm` y no `icon-sm`: comparten alto y relleno, y `sm` deja sitio al texto en la tarjeta. En
    // `md+` el texto es `sr-only` (fuera del flujo), así que el botón vuelve a medir un icono.
    return (
      <Button size="sm" title={label} {...common}>
        {icon}
        <span className="md:sr-only">{label}</span>
      </Button>
    )
  }
  return (
    <Button size="icon-sm" title={label} {...common}>
      {icon}
    </Button>
  )
}
