import { Badge } from '@/components/ui'
import {
  migrationBadgeSpecs,
  migrationBadgeText,
  type MigrationBadgeDensity,
  type MigrationBadgeFacts,
} from '../migration-badges'

interface MigrationBadgesProps {
  migration: MigrationBadgeFacts
  /** Ver `MigrationBadgeDensity`: `compact` en el desplegable, `full` en la ficha. */
  density?: MigrationBadgeDensity
  /** Motor de origen de un baseline de snapshot, para nombrar el `no portable`. */
  sourceEngine?: string | null
  className?: string
}

/**
 * Las insignias de una versión, con el vocabulario de `migration-badges.ts`.
 *
 * Dos decisiones que no son cosméticas:
 *
 * - **Los emojis van en `aria-hidden`.** Un bloque con `🌱 ⚑ ⚠ 🔒 ↩` se anuncia como «planta de
 *   semillero, bandera, advertencia, candado cerrado, flecha curva». El texto de al lado es el que
 *   lleva la información; el emoji es decoración.
 * - **El grupo es una lista**, no N `<span>` hermanos: un lector de pantalla anuncia «lista de 6
 *   elementos» y se puede saltar o recorrer, en vez de leerse como prosa picada.
 *
 * El `title` queda para el matiz, nunca para la consecuencia: `Badge` lo pone en un `<span>` no
 * interactivo, que no es nombre accesible y en táctil no existe. Lo que decide algo va como
 * `Callout` en la ficha (`VersionFactsCard`).
 */
export function MigrationBadges({
  migration,
  density = 'full',
  sourceEngine,
  className,
}: MigrationBadgesProps) {
  const specs = migrationBadgeSpecs(migration, sourceEngine)
  if (specs.length === 0) return null

  return (
    <ul role="list" aria-label="Estado de la versión" className={className}>
      {specs.map((spec) => (
        <li key={spec.key} className="inline-flex">
          <Badge tone={spec.tone} title={spec.title}>
            {spec.icon && <span aria-hidden="true">{spec.icon}</span>}
            {migrationBadgeText(spec, density)}
          </Badge>
        </li>
      ))}
    </ul>
  )
}
