import { Badge, type BadgeTone } from './Badge'

export interface StatusLegendItem {
  key: string
  label: string
  tone: BadgeTone
  /** La consecuencia del estado: lo que el operador tiene que saber para decidir. */
  description: string
}

interface StatusLegendProps {
  /** Solo los estados que aparecen en pantalla: una leyenda de estados ausentes es ruido. */
  items: StatusLegendItem[]
  /** Encabezado corto de la leyenda (p. ej. «Qué significa cada estado»). */
  title?: string
  className?: string
}

/**
 * Leyenda VISIBLE de las insignias de estado de una tabla: la insignia y, al lado, su consecuencia.
 *
 * Existe para sacar del `title` de un `Badge` lo que decide algo. Ese `title` no llega a un lector
 * de pantalla ni en táctil, y repetir la consecuencia en cada fila tampoco sirve: son quince copias
 * idénticas entre las que hay que ir a buscar lo único que varía. Una leyenda, una vez y bajo la
 * tabla, dice lo mismo para todos los usuarios sin ensuciar las filas.
 *
 * Es una lista de definiciones (`<dl>`): un lector de pantalla la anuncia como pares término →
 * definición, que es exactamente lo que es. Sin estados, no se pinta.
 */
export function StatusLegend({
  items,
  title = 'Qué significa cada estado',
  className,
}: StatusLegendProps) {
  if (items.length === 0) return null
  return (
    <section aria-label={title} className={className}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <dl className="flex flex-col gap-1.5 text-xs">
        {items.map((item) => (
          <div key={item.key} className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <dt className="shrink-0">
              <Badge tone={item.tone}>{item.label}</Badge>
            </dt>
            <dd className="min-w-0 flex-1 text-muted-foreground">{item.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
