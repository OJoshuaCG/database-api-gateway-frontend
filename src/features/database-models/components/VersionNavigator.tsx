import {
  Badge,
  Callout,
  Card,
  CardContent,
  ChevronLeftIcon,
  ChevronRightIcon,
  Combobox,
  IconButton,
} from '@/components/ui'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { versionNeighbors } from '../version-nav'
import { describeMigrationBadges } from '../migration-badges'
import { MigrationBadges } from './MigrationBadges'

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
 * Va `sticky` bajo el `Topbar` (cuyo alto es `--topbar-h`) porque el detalle es largo —formulario de
 * SQL más los bloques traducidos— y al hacer scroll se perdía de vista cuál se estaba mirando.
 * Necesita `z-30` y no un valor menor: al ser sticky crea contexto de apilamiento propio, así que
 * con un z por debajo del `Topbar` (z-20) el desplegable quedaría tapado por él.
 *
 * **Desde que `VersionsTable` se eliminó, este desplegable es el índice del catálogo**, así que sus
 * insignias salen del vocabulario compartido (`migration-badges.ts`) y ya no de un `renderItem`
 * escrito a mano que omitía `no portable`, `SQL congelado`, `SQL editado tras aplicarse` y —el más
 * grave— `sin rollback`. Para ESCANEAR el catálogo está la `VersionAlertsBar`: las insignias de aquí
 * solo existen mientras el menú está abierto, y el menú se cierra al elegir.
 */
export function VersionNavigator({ sorted, index, onSelect, total }: VersionNavigatorProps) {
  const selected = sorted[index] ?? null
  const { previous, next, position, isLatest } = versionNeighbors(sorted, index)

  // El backend no devuelve más de `PAGINATION.maxSize` versiones por página. Si el catálogo vino
  // recortado, `sorted` son las primeras N en el orden que quiso el backend y la punta REAL puede
  // no estar entre ellas: entonces «más reciente» sería una afirmación sin respaldo, justo al lado
  // de la ficha que ofrece borrar. Se avisa y no se afirma.
  const truncated = total > sorted.length

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
                    <MigrationBadges
                      migration={m}
                      density="compact"
                      className="ml-auto flex shrink-0 items-center gap-1"
                    />
                  </div>
                )}
              />
            </div>
            {/* Las flechas recorren la secuencia sin abrir el desplegable, que es el gesto natural
                para ir comparando versiones contiguas.

                `aria-disabled` y un handler que no hace nada, en vez de `disabled`: al llegar al
                extremo, un botón enfocado que se deshabilita **pierde el foco** —cae a `<body>` y el
                siguiente Tab reinicia el documento—. Con estas flechas como navegación principal,
                eso se nota en cada recorrido. */}
            <div className="flex shrink-0 gap-1">
              <IconButton
                label="Versión anterior"
                icon={<ChevronLeftIcon />}
                variant="outline"
                size="icon"
                aria-disabled={previous === null}
                className={previous === null ? 'opacity-50' : undefined}
                onClick={() => previous && onSelect(previous)}
              />
              <IconButton
                label="Versión siguiente"
                icon={<ChevronRightIcon />}
                variant="outline"
                size="icon"
                aria-disabled={next === null}
                className={next === null ? 'opacity-50' : undefined}
                onClick={() => next && onSelect(next)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* La ÚNICA región live de la pantalla, y anuncia la versión entera con su estado.
                Antes decía «3 de 12» y nada más: quien navega con lector de pantalla pulsaba la
                flecha y no se enteraba ni de qué versión ni de si estaba sin revisar. No se añade
                una segunda región en la ficha a propósito: dos que cambian a la vez se pisan y solo
                se oye una.

                Va SEPARADA del contador visible y no envolviéndolo: si la región contuviera los dos
                textos, el anuncio sería la concatenación de ambos y el contador quedaría pegado al
                final de la frase. Así cada uno dice lo suyo, y el visible va `aria-hidden` para no
                anunciarse dos veces. */}
            <span aria-live="polite" className="sr-only">
              {selected
                ? `Versión ${selected.version}, ${selected.name}. ${describeMigrationBadges(selected).join(', ')}. Posición ${position} de ${sorted.length}.`
                : 'Sin versión seleccionada.'}
            </span>
            <span aria-hidden="true">
              {position} de {sorted.length}
            </span>
            {isLatest && !truncated && <Badge tone="success">más reciente</Badge>}
          </div>

          {truncated && (
            <Callout tone="warning" title={`Se cargaron ${sorted.length} de ${total} versiones`}>
              <p>
                El catálogo vino recortado por el tope de página, así que no se puede afirmar cuál es
                la última versión: ni la insignia «más reciente» ni el borrado de la punta son
                fiables en esta vista.
              </p>
            </Callout>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
