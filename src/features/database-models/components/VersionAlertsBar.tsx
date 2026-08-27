import { useState } from 'react'
import { Button, Card, CardContent } from '@/components/ui'
import { hasVersionAlerts, type VersionAlerts } from '../version-alerts'

interface VersionAlertsBarProps {
  alerts: VersionAlerts
  /** Versión visible ahora mismo, para marcarla dentro de la lista desplegada. */
  selectedVersion: string | null
  onSelect: (version: string) => void
}

/**
 * Los avisos del catálogo, con la lista de versiones de cada uno.
 *
 * **Repone lo que se llevó `VersionsTable`.** El desplegable sirve para MOVERSE entre versiones,
 * nunca para escanearlas: sus insignias solo existen mientras el menú está abierto, y el menú se
 * cierra al elegir. Sin esta barra, «¿qué versiones no tienen rollback?» pasaba a contestarse
 * abriendo las doce, una por una, y recordando el resultado.
 *
 * Es también el destino de los dos textos de la app que mandaban «a la tabla de versiones»:
 * `describeCaptureRejection` (`capture.ts`) y el aviso previo del `ApplyMigrationsDialog`.
 *
 * Va **cerrada**: cuatro listas abiertas empujarían el selector y la ficha fuera de la pantalla, que
 * es el problema que este cambio venía a resolver. Y solo se abre una a la vez — comparar dos cubos
 * a la vez no es el gesto (para eso está la insignia de cada versión en la ficha), y dos listas
 * abiertas vuelven a ser la tabla.
 */
export function VersionAlertsBar({ alerts, selectedVersion, onSelect }: VersionAlertsBarProps) {
  const [open, setOpen] = useState<string | null>(null)

  if (!hasVersionAlerts(alerts)) return null

  const chips = [
    {
      key: 'unreviewed',
      versions: alerts.unreviewed,
      label: 'sin revisar',
      // Lo que hace cada aviso ACCIONABLE es su consecuencia, no su nombre. Va visible, no en un
      // `title`: es lo que decide si hay que hacer algo antes del próximo apply.
      consequence: 'El apply las rechaza con 409 hasta aprobarlas.',
    },
    {
      key: 'withoutRollback',
      versions: alerts.withoutRollback,
      label: 'sin rollback',
      consequence: 'Cualquier rollback que las atraviese falla con 409, para todo el camino.',
    },
    {
      key: 'diverged',
      versions: alerts.diverged,
      label: 'SQL editado tras aplicarse',
      consequence: 'Hay bases que conservan el esquema anterior a la edición.',
    },
    {
      key: 'frozen',
      versions: alerts.frozen,
      label: 'SQL congelado',
      consequence: 'Editar su SQL base pide confirmación explícita.',
    },
  ].filter((chip) => chip.versions.length > 0)

  const expanded = chips.find((chip) => chip.key === open) ?? null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Avisos del blueprint</span>
          {chips.map((chip) => (
            <Button
              key={chip.key}
              size="sm"
              variant={open === chip.key ? 'outline' : 'ghost'}
              aria-expanded={open === chip.key}
              onClick={() => setOpen(open === chip.key ? null : chip.key)}
            >
              {chip.versions.length} {chip.label}
            </Button>
          ))}
        </div>

        {expanded && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{expanded.consequence}</p>
            <div className="flex flex-wrap gap-1.5">
              {expanded.versions.map((version) => (
                <Button
                  key={version}
                  size="sm"
                  variant={version === selectedVersion ? 'outline' : 'ghost'}
                  aria-current={version === selectedVersion ? 'true' : undefined}
                  onClick={() => onSelect(version)}
                >
                  <code>{version}</code>
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
