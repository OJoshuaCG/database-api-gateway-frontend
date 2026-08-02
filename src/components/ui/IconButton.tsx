import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'aria-label'> {
  /**
   * Nombre accesible y tooltip, en un solo sitio. Es obligatorio a propósito: un botón sin texto
   * sin nombre accesible es invisible para un lector de pantalla, y el error es imposible de ver
   * mirando la pantalla. Al exigirlo el tipo, no se puede olvidar.
   */
  label: string
  icon: ReactNode
  /** `icon-sm` (32 px) para acciones de fila; `icon` (40 px) junto a controles de altura normal. */
  size?: 'icon' | 'icon-sm'
}

/**
 * Botón de solo icono. Úsalo cuando la acción se repite (filas de una tabla, barras de
 * herramientas) Y es universalmente reconocible: editar, eliminar, actualizar, copiar, navegar.
 *
 * Para acciones de dominio —«Adoptar», «Reconciliar», «Aplicar a todas»— usa `Button` con texto:
 * ningún icono las comunica, y sustituirlas por uno hace la interfaz menos entendible, no más.
 *
 * Ojo: un botón `disabled` no dispara el tooltip nativo. Si el motivo de la deshabilitación es
 * importante, envuélvelo en un `<span title="…">`, como ya hace `ModelMigrationDetailPanel`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'icon-sm', variant = 'ghost', ...props },
  ref,
) {
  return (
    <Button ref={ref} size={size} variant={variant} aria-label={label} title={label} {...props}>
      {icon}
    </Button>
  )
})
