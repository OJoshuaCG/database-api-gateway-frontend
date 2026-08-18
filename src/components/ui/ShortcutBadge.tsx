import { Badge } from './Badge'

/**
 * Marca visual para una acción de fila que DUPLICA algo que también existe en la ficha completa
 * de la entidad (decisión de producto: se conservan como atajo para operarios avanzados, no se
 * eliminan). El texto va en `title` porque el badge ya es visible sin hover — a diferencia de un
 * `title` puesto directo en el botón, no depende de que el puntero pase por encima para saberlo.
 *
 * Un solo criterio en las tres pantallas que tienen atajos: `ManagedDatabasesPage`,
 * `ServerUsersPage` y `EngineUsersPanel`.
 */
export function ShortcutBadge({ title, className }: { title: string; className?: string }) {
  return (
    <Badge tone="neutral" title={title} className={className}>
      Atajo
    </Badge>
  )
}
