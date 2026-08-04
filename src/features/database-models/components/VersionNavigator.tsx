import {
  Badge,
  Card,
  CardContent,
  ChevronLeftIcon,
  ChevronRightIcon,
  Combobox,
  IconButton,
} from '@/components/ui'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { versionNeighbors } from '../version-nav'

interface VersionNavigatorProps {
  /** Catálogo YA ordenado ascendente por versión. */
  sorted: ModelMigrationSummary[]
  /** Índice de la versión visible dentro de `sorted`. */
  index: number
  onSelect: (version: string) => void
  /** Total según el backend; puede superar a `sorted.length` si la página se quedó corta. */
  total: number
}

/**
 * Selector de versión del blueprint: desplegable + flechas de anterior/siguiente.
 *
 * Va `sticky` bajo el `Topbar` (cuyo alto es `--topbar-h`) porque el panel de detalle es largo —formulario
 * de SQL más los bloques traducidos— y al hacer scroll se perdía de vista cuál de las versiones
 * se estaba mirando. Necesita `z-30` y no un valor menor: al ser sticky crea contexto de
 * apilamiento propio, así que con un z por debajo del `Topbar` (z-20) el desplegable del
 * Combobox quedaría tapado por él.
 */
export function VersionNavigator({ sorted, index, onSelect, total }: VersionNavigatorProps) {
  const selected = sorted[index] ?? null
  const { previous, next, position, isLatest } = versionNeighbors(sorted, index)

  return (
    <Card className="sticky top-[var(--topbar-h)] z-30">
      <CardContent className="py-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Combobox<ModelMigrationSummary>
                items={sorted}
                value={selected}
                onChange={(migration) => migration && onSelect(migration.version)}
                itemToString={(m) => `${m.version} · ${m.name}`}
                itemToKey={(m) => m.id}
                label="Versión"
                placeholder="Selecciona una versión…"
                renderItem={(m) => (
                  <div className="flex w-full items-center gap-2">
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                      {m.version}
                    </code>
                    <span className="truncate text-foreground">{m.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {m.is_baseline && <Badge tone="info">baseline</Badge>}
                      {m.reviewed === false && <Badge tone="warning">⚠</Badge>}
                      {m.has_rollback && <Badge tone="success">↩</Badge>}
                    </span>
                  </div>
                )}
              />
            </div>
            {/* Las flechas recorren la secuencia sin abrir el desplegable, que es el gesto
                natural para ir comparando versiones contiguas. */}
            <div className="flex shrink-0 gap-1">
              <IconButton
                label="Versión anterior"
                icon={<ChevronLeftIcon />}
                variant="outline"
                size="icon"
                disabled={previous === null}
                onClick={() => previous && onSelect(previous)}
              />
              <IconButton
                label="Versión siguiente"
                icon={<ChevronRightIcon />}
                variant="outline"
                size="icon"
                disabled={next === null}
                onClick={() => next && onSelect(next)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              {position} de {sorted.length}
            </span>
            {isLatest && <Badge tone="success">más reciente</Badge>}
            {total > sorted.length && <span>· {total} versión(es) en total</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
