import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CodeBlock,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Pagination,
  Spinner,
  Switch,
} from '@/components/ui'
import {
  MIGRATION_ERROR_CODES,
  MIGRATION_SEARCH_MAX_LENGTH,
  MIGRATION_SEARCH_MIN_LENGTH,
  type MigrationSearchHit,
} from '@/lib/contracts'
import { toApiError, type ApiError } from '@/lib/api/errors'
import { cn, formatDateTime } from '@/lib/utils'
import { useDebouncedValue } from '@/lib/utils/use-debounced-value'
import { useModelMigration, useModelMigrationSearch } from '../hooks/use-model-migrations'
import {
  DEFAULT_MIGRATION_SEARCH_FILTERS,
  MIGRATION_SEARCH_LAST_PRESETS,
  dateRangeError,
  hasNarrowingFilters,
  hiddenMatchedLines,
  isSearchTermReady,
  matchSummary,
  migrationSearchFiltersKey,
  normalizeSearchTerm,
  splitSnippet,
  type MigrationSearchFilters,
  type MigrationSearchOrder,
} from '../migration-search'

const PAGE_SIZE = 20
/** Suficiente para no pedir una página por tecla; corto para que no se sienta lento. */
const SEARCH_DEBOUNCE_MS = 300

/** Versión abierta en el visor y la línea que hay que señalar en ella. */
interface OpenedHit {
  hit: MigrationSearchHit
  line: number | undefined
}

/**
 * Pestaña «Buscar en el SQL» de `BlueprintMigrationsPage`: qué versiones del blueprint contienen
 * un texto literal en su SQL base.
 *
 * Solo lee la BD del gateway (ningún motor 🔌, sin rate limit propio), así que se busca mientras se
 * escribe, con debounce. Los resultados son tarjetas con fragmentos y no una `DataTable`: cada
 * versión trae hasta tres líneas de SQL, y eso no es una fila tabular.
 *
 * Al abrir un resultado **no** se navega al navegador de versiones: ese catálogo está paginado y su
 * `?version=` cae a la punta cuando la versión no está en la página cargada, que es el caso común
 * para una búsqueda —suele encontrar versiones viejas—. Se abre un visor propio que pide la versión
 * exacta (`MigrationSearchVersionModal`).
 */
export function MigrationSearchPanel({
  modelId,
  onOpenInCatalog,
}: {
  modelId: number
  /**
   * Selecciona la versión en la pestaña «Versiones». Hace falta además del enlace porque la página
   * lee `?version=` solo al montar, y el enlace navega a la MISMA ruta: sin esto, la URL cambiaría
   * y la ficha seguiría mostrando otra versión.
   */
  onOpenInCatalog?: (version: string) => void
}) {
  const [filters, setFilters] = useState<MigrationSearchFilters>(DEFAULT_MIGRATION_SEARCH_FILTERS)
  const [opened, setOpened] = useState<OpenedHit | null>(null)
  const lastLabelId = useId()
  const orderLabelId = useId()

  // Lo que se busca es el término AMORTIGUADO; el resto de filtros aplica al instante, porque se
  // cambian de un clic y no hay tecleo que amortiguar.
  const debouncedQ = useDebouncedValue(filters.q, SEARCH_DEBOUNCE_MS)
  const effective = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ])

  /*
   * La página vuelve a 1 cuando cambia cualquier filtro, sin `useEffect`: se guarda junto a la
   * clave de filtros con la que se eligió y, si la clave actual es otra, vale 1. Es derivación
   * pura en render. La clave sale del término AMORTIGUADO: con el término en vivo, la página 1 se
   * pediría todavía con el texto viejo, y la nueva request llegaría 300 ms después en la página
   * que ya se había descartado.
   */
  const filtersKey = migrationSearchFiltersKey(effective)
  const [paging, setPaging] = useState({ key: filtersKey, page: 1 })
  const page = paging.key === filtersKey ? paging.page : 1

  const search = useModelMigrationSearch(modelId, effective, page, PAGE_SIZE)

  const update = (patch: Partial<MigrationSearchFilters>) =>
    setFilters((current) => ({ ...current, ...patch }))

  const termReady = isSearchTermReady(filters.q)
  const rangeError = dateRangeError(filters.dateFrom, filters.dateTo)
  // El término en pantalla todavía no llegó a la request: se está escribiendo.
  const typing = normalizeSearchTerm(filters.q) !== normalizeSearchTerm(debouncedQ)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <Input
            type="search"
            label="Texto a buscar"
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            maxLength={MIGRATION_SEARCH_MAX_LENGTH}
            placeholder="Por ejemplo, un nombre de tabla o de columna"
            autoComplete="off"
            spellCheck={false}
            // El mínimo es AYUDA y no error: no haber escrito lo suficiente no es equivocarse.
            hint={`Mínimo ${MIGRATION_SEARCH_MIN_LENGTH} caracteres, sin contar los espacios de los extremos.`}
          />

          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start lg:gap-6">
            <div className="flex flex-col gap-1.5">
              <span id={lastLabelId} className="text-sm font-medium text-foreground">
                Versiones a revisar
              </span>
              <div role="group" aria-labelledby={lastLabelId} className="flex flex-wrap gap-1.5">
                {MIGRATION_SEARCH_LAST_PRESETS.map((preset) => (
                  <ChoiceButton
                    key={preset ?? 'all'}
                    active={filters.last === preset}
                    onClick={() => update({ last: preset })}
                  >
                    {preset === null ? 'Todas' : `Últimas ${preset}`}
                  </ChoiceButton>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span id={orderLabelId} className="text-sm font-medium text-foreground">
                Orden
              </span>
              <div role="group" aria-labelledby={orderLabelId} className="flex flex-wrap gap-1.5">
                {ORDER_OPTIONS.map((option) => (
                  <ChoiceButton
                    key={option.value}
                    active={filters.order === option.value}
                    onClick={() => update({ order: option.value })}
                  >
                    {option.label}
                  </ChoiceButton>
                ))}
              </div>
            </div>

            <div className="pt-1 lg:pt-7">
              <Switch
                checked={filters.caseSensitive}
                onCheckedChange={(caseSensitive) => update({ caseSensitive })}
                label="Distinguir mayúsculas"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="date"
              label="Creada desde"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(event) => update({ dateFrom: event.target.value })}
            />
            <Input
              type="date"
              label="Creada hasta"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(event) => update({ dateTo: event.target.value })}
              // El motivo va visible bajo el campo: sin él, la búsqueda simplemente no correría y
              // no habría nada en pantalla que explicara por qué.
              error={rangeError ?? undefined}
              hint="Los dos extremos son opcionales e inclusivos. Se compara por día, sin hora."
            />
          </div>

          {filters.last !== null && (filters.dateFrom !== '' || filters.dateTo !== '') && (
            <p className="text-xs text-muted-foreground">
              Primero se toman las últimas {filters.last} versiones y, dentro de ellas, las del
              rango de fechas: el resultado puede tener menos de {filters.last}.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Búsqueda literal —<code className="font-mono">%</code> y{' '}
            <code className="font-mono">_</code> se buscan tal cual, no son comodines— sobre el SQL
            base de cada versión, no sobre sus traducciones por motor.
          </p>
        </CardContent>
      </Card>

      <SearchResults
        filters={effective}
        termReady={termReady}
        rangeInvalid={rangeError !== null}
        typing={typing}
        search={search}
        onPageChange={(next) => setPaging({ key: filtersKey, page: next })}
        onOpen={(hit, line) => setOpened({ hit, line })}
      />

      {opened && (
        <MigrationSearchVersionModal
          // Remonta al cambiar de versión: el visor nace con su propio scroll y su propia línea.
          key={`${opened.hit.version}-${opened.line ?? ''}`}
          modelId={modelId}
          hit={opened.hit}
          line={opened.line}
          onClose={() => setOpened(null)}
          onOpenInCatalog={onOpenInCatalog}
        />
      )}
    </div>
  )
}

const ORDER_OPTIONS: { value: MigrationSearchOrder; label: string }[] = [
  { value: 'desc', label: 'Más recientes primero' },
  { value: 'asc', label: 'Más antiguas primero' },
]

function SearchResults({
  filters,
  termReady,
  rangeInvalid,
  typing,
  search,
  onPageChange,
  onOpen,
}: {
  filters: MigrationSearchFilters
  termReady: boolean
  rangeInvalid: boolean
  typing: boolean
  search: ReturnType<typeof useModelMigrationSearch>
  onPageChange: (page: number) => void
  onOpen: (hit: MigrationSearchHit, line: number | undefined) => void
}) {
  // Antes del mínimo no hay búsqueda: un «sin resultados» acá afirmaría algo que nadie preguntó.
  if (!termReady) {
    return (
      <p className="text-sm text-muted-foreground">
        Escribí al menos {MIGRATION_SEARCH_MIN_LENGTH} caracteres para buscar en el SQL de las
        versiones de este blueprint.
      </p>
    )
  }
  if (rangeInvalid) {
    return <p className="text-sm text-muted-foreground">Corregí el rango de fechas para buscar.</p>
  }
  if (search.isError) {
    const apiError = toApiError(search.error)
    const known = searchErrorText(apiError)
    return known ? (
      <Callout tone="warning" title="El gateway rechazó la búsqueda">
        <p>{known}</p>
      </Callout>
    ) : (
      <ErrorState
        error={search.error}
        title="No se pudo buscar en el SQL"
        onRetry={() => void search.refetch()}
      />
    )
  }
  if (!search.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Buscando…
      </div>
    )
  }

  const { items, pagination } = search.data
  const term = normalizeSearchTerm(filters.q)
  const busy = search.isFetching || typing

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {pagination.total} {pagination.total === 1 ? 'versión' : 'versiones'} con coincidencias
        </span>
        {busy && <Spinner className="h-4 w-4" label="Actualizando resultados" />}
      </div>

      {/* El vacío va dentro y no como retorno temprano: una página que quedó vacía —el catálogo se
          acortó mientras se miraba la 3— tiene que conservar la paginación para poder volver. */}
      {items.length === 0 ? (
        <EmptyState title={`No se encontró «${term}»`} description={emptyDescription(filters)} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((hit) => (
            <li key={hit.id}>
              <SearchHitCard hit={hit} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}

      {pagination.pages > 1 && (
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          size={pagination.size}
          hasNext={pagination.has_next}
          hasPrev={pagination.has_prev}
          onPageChange={onPageChange}
          isFetching={search.isFetching}
        />
      )}
    </div>
  )
}

/** Texto del vacío: si hay filtros que acotan, lo útil es sugerir ampliarlos. */
function emptyDescription(filters: MigrationSearchFilters): string {
  const hints: string[] = []
  if (filters.last !== null) hints.push('revisar todas las versiones')
  if (filters.dateFrom !== '' || filters.dateTo !== '') hints.push('ampliar el rango de fechas')
  if (filters.caseSensitive) hints.push('dejar de distinguir mayúsculas')
  const base = hasNarrowingFilters(filters)
    ? 'Ninguna versión lo contiene con los filtros actuales.'
    : 'Ninguna versión de este blueprint lo contiene en su SQL base.'
  return hints.length > 0 ? `${base} Probá ${joinSpanish(hints)}.` : base
}

function joinSpanish(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} o ${parts[parts.length - 1]}`
}

/**
 * Los dos 422 con código propio. Se clasifica por `public_context.code`, nunca por la prosa. La UI
 * los previene antes de pedir, así que verlos quiere decir que cliente y backend discrepan en la
 * regla; el resto de errores (404, 422 genérico, red) va a `ErrorState`.
 */
function searchErrorText(apiError: ApiError): string | null {
  switch (apiError.code) {
    case MIGRATION_ERROR_CODES.searchQueryTooShort:
      return `El gateway exige un término más largo: al menos ${MIGRATION_SEARCH_MIN_LENGTH} caracteres sin contar los espacios de los extremos.`
    case MIGRATION_ERROR_CODES.searchInvalidDateRange:
      return 'La fecha «desde» es posterior a la fecha «hasta». Corregí el rango para buscar.'
    default:
      return null
  }
}

function SearchHitCard({
  hit,
  onOpen,
}: {
  hit: MigrationSearchHit
  onOpen: (hit: MigrationSearchHit, line: number | undefined) => void
}) {
  const hidden = hiddenMatchedLines(hit)
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => onOpen(hit, undefined)}
            className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <code className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs">
              {hit.version}
            </code>
            <span className="min-w-0 break-words text-sm font-medium">{hit.name}</span>
          </button>
          {hit.is_latest && <Badge tone="info">Última</Badge>}
          <span className="text-xs text-muted-foreground">{formatDateTime(hit.created_at)}</span>
        </div>

        <p className="text-xs text-muted-foreground">{matchSummary(hit)}</p>

        <ol className="flex flex-col gap-1">
          {hit.snippets.map((snippet) => {
            const parts = splitSnippet(snippet)
            return (
              <li key={snippet.line}>
                <button
                  type="button"
                  onClick={() => onOpen(hit, snippet.line)}
                  aria-label={`Abrir la versión ${hit.version} en la línea ${snippet.line}`}
                  className="flex w-full gap-3 rounded-md border border-border bg-syntax-bg px-2 py-1.5 text-left font-mono text-xs transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-10 shrink-0 text-right text-syntax-gutter">
                    {snippet.line}
                  </span>
                  {/* `break-all` y `pre-wrap`: un fragmento de 160 caracteres parte línea en vez de
                      desbordar la tarjeta. Acá sí se puede partir un identificador, porque esto es
                      un extracto para ubicar la coincidencia, no el SQL que se va a leer. */}
                  <span className="min-w-0 whitespace-pre-wrap break-all text-syntax-plain">
                    {parts.before}
                    <mark className="rounded-sm bg-warning/25 text-syntax-plain">
                      {parts.match}
                    </mark>
                    {parts.after}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            y {hidden} {hidden === 1 ? 'línea más' : 'líneas más'} con coincidencias
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Visor de UNA versión exacta, pedida por su número con `useModelMigration`.
 *
 * Muestra el **`up_sql` base**, no las traducciones por motor (`translated.mysql` /
 * `translated.postgresql`, que es lo que pinta `MigrationSqlView`): los números de línea de la
 * búsqueda se refieren al SQL base, y en una traducción la misma línea puede ser otra —la
 * traducción reescribe y reparte sentencias—, así que resaltarla ahí señalaría código distinto.
 */
function MigrationSearchVersionModal({
  modelId,
  hit,
  line,
  onClose,
  onOpenInCatalog,
}: {
  modelId: number
  hit: MigrationSearchHit
  /** Línea del fragmento que se clicó; si se abrió la versión entera, la primera coincidencia. */
  line: number | undefined
  onClose: () => void
  onOpenInCatalog?: (version: string) => void
}) {
  const detail = useModelMigration(modelId, hit.version, true)
  const highlightLine = line ?? hit.snippets[0]?.line

  let body: ReactNode
  if (detail.isLoading) {
    body = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando el SQL de la versión…
      </div>
    )
  } else if (detail.isError || !detail.data) {
    body = (
      <ErrorState
        error={detail.error}
        title="No se pudo cargar la versión"
        onRetry={() => void detail.refetch()}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {highlightLine !== undefined && (
          <p className="text-xs text-muted-foreground">
            Resaltada la línea {highlightLine} del SQL base, el mismo sobre el que se buscó.
          </p>
        )}
        <CodeBlock
          code={detail.data.up_sql}
          title="SQL base (up_sql)"
          highlightLine={highlightLine}
          // Ya es un visor amplio: expandirlo abriría otro diálogo encima de este.
          hideFullscreen
          maxHeightClass="max-h-[calc(100dvh-20rem)]"
        />
      </div>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Versión ${hit.version}`}
      description={hit.name}
      size="full"
      footer={
        <>
          <div className="mr-auto flex flex-col gap-0.5">
            <Link
              to={`/database-models/${modelId}/migrations?version=${encodeURIComponent(hit.version)}`}
              onClick={() => onOpenInCatalog?.(hit.version)}
              className="w-fit text-sm text-primary hover:underline"
            >
              Abrir en el catálogo de versiones
            </Link>
            <span className="text-xs text-muted-foreground">
              Ahí se abre la ficha completa de la versión, con su edición y sus traducciones por
              motor.
            </span>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  )
}

/** Opción de un control segmentado: mismo aspecto que las de `ModelMigrationForm`. */
function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input text-muted-foreground hover:bg-primary/10 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
