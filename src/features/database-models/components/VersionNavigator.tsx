import {
  Badge,
  Card,
  CardContent,
  ChevronLeftIcon,
  ChevronRightIcon,
  Combobox,
  IconButton,
  Pagination,
} from '@/components/ui'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { versionNeighbors } from '../version-nav'
import { describeMigrationBadges } from '../migration-badges'
import { MigrationBadges } from './MigrationBadges'

/** Meta de paginación con la página ya en números de PANTALLA (ver `flipPage`). */
export interface VersionPageMeta {
  page: number
  pages: number
  total: number
  size: number
}

interface VersionNavigatorProps {
  /** Catálogo de la PÁGINA actual, ya ordenado ascendente por versión. */
  sorted: ModelMigrationSummary[]
  /** Índice de la versión visible dentro de `sorted`. */
  index: number
  onSelect: (version: string) => void
  pagination: VersionPageMeta
  onPageChange: (page: number) => void
  onSizeChange: (size: number) => void
  /**
   * Salto a la página contigua desde una flecha, seleccionando su versión del extremo para que
   * la secuencia siga sin huecos ni saltos.
   */
  onCrossPage: (direction: 'older' | 'newer') => void
  isFetching?: boolean
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
 *
 * **El desplegable muestra una PÁGINA, no el catálogo entero.** Antes pedía una sola página del
 * tamaño máximo y, si el blueprint tenía más versiones, avisaba del recorte y ya: no había forma
 * de llegar a las que faltaban. Ahora hay paginador, y las flechas cruzan de página en el borde
 * en vez de morir ahí, así que la secuencia se recorre entera sin abrir el menú.
 */
export function VersionNavigator({
  sorted,
  index,
  onSelect,
  pagination,
  onPageChange,
  onSizeChange,
  onCrossPage,
  isFetching,
}: VersionNavigatorProps) {
  const selected = sorted[index] ?? null
  const { previous, next, position } = versionNeighbors(sorted, index)

  const { page, pages, total, size } = pagination
  const multiPage = pages > 1
  // Extremos REALES del catálogo, no de la página: en el borde interior hay página contigua a la
  // que saltar. `page` ya viene en números de pantalla, donde 1 son las versiones más antiguas.
  const hasOlderPage = page > 1
  const hasNewerPage = page < pages
  const canGoOlder = previous !== null || hasOlderPage
  const canGoNewer = next !== null || hasNewerPage

  const goOlder = () => (previous !== null ? onSelect(previous) : onCrossPage('older'))
  const goNewer = () => (next !== null ? onSelect(next) : onCrossPage('newer'))

  // Única fuente de la punta: el backend la resuelve sobre TODO el catálogo (api-reference-v22
  // §3). Deducirla de la posición en la lista mentía en cuanto había más de una página, y lo
  // hacía justo al lado de la ficha que ofrece borrar.
  const isLatest = selected?.is_latest ?? false

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
                eso se nota en cada recorrido.

                Solo se apagan en los extremos REALES del catálogo. En el borde de la página saltan
                a la contigua: si murieran ahí, con un blueprint de más de una página la secuencia
                quedaría cortada en un punto arbitrario —el tope de página— sin nada que lo
                explicara. */}
            <div className="flex shrink-0 gap-1">
              <IconButton
                label="Versión anterior"
                icon={<ChevronLeftIcon />}
                variant="outline"
                size="icon"
                aria-disabled={!canGoOlder}
                className={!canGoOlder ? 'opacity-50' : undefined}
                onClick={() => canGoOlder && goOlder()}
              />
              <IconButton
                label="Versión siguiente"
                icon={<ChevronRightIcon />}
                variant="outline"
                size="icon"
                aria-disabled={!canGoNewer}
                className={!canGoNewer ? 'opacity-50' : undefined}
                onClick={() => canGoNewer && goNewer()}
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
                ? `Versión ${selected.version}, ${selected.name}. ${describeMigrationBadges(selected).join(', ')}. Posición ${position} de ${sorted.length}${multiPage ? ` en esta página, página ${page} de ${pages}` : ''}.`
                : 'Sin versión seleccionada.'}
            </span>
            <span aria-hidden="true">
              {position} de {sorted.length}
              {multiPage && ' en esta página'}
            </span>
            {isLatest && <Badge tone="success">más reciente</Badge>}
          </div>

          {/* El paginador solo aparece cuando hay más de una página: con un blueprint corto —el
              caso normal— sería un control permanente que nunca hace nada.

              Sus flechas van en el MISMO sentido que las del navegador (◀ hacia versiones más
              antiguas) porque `page` llega ya invertida respecto de la página de la API: ver
              `flipPage`, que explica por qué el catálogo se pide descendente y se muestra
              ascendente. */}
          {multiPage && (
            <Pagination
              page={page}
              pages={pages}
              total={total}
              size={size}
              hasNext={hasNewerPage}
              hasPrev={hasOlderPage}
              onPageChange={onPageChange}
              onSizeChange={onSizeChange}
              isFetching={isFetching}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
