import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { IconButton } from './IconButton'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { Input } from './Input'

interface ColumnOption {
  id: string
  label: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  isLoading?: boolean
  isFetching?: boolean
  emptyState?: ReactNode
  /** Búsqueda global client-side (sobre los datos cargados — la API no la soporta server-side). */
  enableGlobalFilter?: boolean
  searchPlaceholder?: string
  enableColumnVisibility?: boolean
  /** Slot para filtros server-side específicos de cada feature. */
  toolbar?: ReactNode
  /** Si se indica, activa paginación client-side (para listas NO paginadas como privilegios). */
  clientPageSize?: number
  getRowId?: (row: T) => string
}

function headerLabel<T>(column: ColumnDef<T>): string {
  const header = column.header
  if (typeof header === 'string') return header
  return column.id ?? ''
}

export function DataTable<T>({
  data,
  columns,
  isLoading,
  isFetching,
  emptyState,
  enableGlobalFilter = true,
  searchPlaceholder = 'Buscar…',
  enableColumnVisibility = false,
  toolbar,
  clientPageSize,
  getRowId,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsPanelId = useId()

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: enableGlobalFilter ? getFilteredRowModel() : undefined,
    getPaginationRowModel: clientPageSize ? getPaginationRowModel() : undefined,
    initialState: clientPageSize
      ? { pagination: { pageSize: clientPageSize, pageIndex: 0 } }
      : undefined,
  })

  const hideableColumns = useMemo<ColumnOption[]>(
    () =>
      table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide())
        .map((column) => ({ id: column.id, label: headerLabel(column.columnDef) || column.id })),
    [table],
  )

  const visibleColumnOptions = hideableColumns.filter(
    (option) => table.getColumn(option.id)?.getIsVisible() ?? true,
  )

  const rows = table.getRowModel().rows
  const showEmpty = !isLoading && rows.length === 0

  return (
    <div className="flex flex-col gap-3">
      {(enableGlobalFilter || enableColumnVisibility || toolbar) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            {enableGlobalFilter && (
              <div className="w-full sm:max-w-xs">
                <Input
                  value={globalFilter}
                  onChange={(event) => setGlobalFilter(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label="Buscar en la tabla"
                  type="search"
                />
              </div>
            )}
            {toolbar}
          </div>
          {enableColumnVisibility && hideableColumns.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-expanded={columnsOpen}
              aria-controls={columnsPanelId}
              onClick={() => setColumnsOpen((open) => !open)}
            >
              Columnas ({visibleColumnOptions.length}/{hideableColumns.length})
            </Button>
          )}
        </div>
      )}

      {/* Panel a todo el ancho y solo mientras está abierto: la visibilidad de columnas se
          ajusta una vez y casi nunca se retoca, así que no debe robar sitio —ni horizontal ni
          vertical— a los filtros de datos, que sí se usan continuamente. Abierto, en cambio,
          dispone de toda la anchura de la tabla, que es donde una lista de columnas se lee de
          un vistazo. */}
      {enableColumnVisibility && columnsOpen && hideableColumns.length > 0 && (
        <div id={columnsPanelId} className="rounded-card border border-border bg-surface-muted p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Columnas visibles</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={visibleColumnOptions.length === hideableColumns.length}
              onClick={() => setColumnVisibility({})}
            >
              Mostrar todas
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hideableColumns.map((option) => {
              const isVisible = table.getColumn(option.id)?.getIsVisible() ?? true
              return (
                <Checkbox
                  key={option.id}
                  label={option.label}
                  checked={isVisible}
                  // Ocultar la última dejaría una tabla en blanco, sin forma evidente de
                  // recuperarla salvo dando con este mismo panel.
                  disabled={isVisible && visibleColumnOptions.length === 1}
                  onChange={(event) =>
                    setColumnVisibility((previous) => ({
                      ...previous,
                      [option.id]: event.target.checked,
                    }))
                  }
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Regla del proyecto: una tabla no lleva scroll horizontal salvo caso extraordinario
          documentado aparte. Por debajo de `md` se cambia a una tarjeta por fila (abajo) en vez
          de encoger columnas hasta ilegibilidad o esconder el contenido detrás de un scroll que
          en móvil nadie descubre arrastrando. */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : canSort
                              ? 'none'
                              : undefined
                      }
                      className="whitespace-nowrap px-4 py-3 text-left font-semibold text-muted-foreground"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden className="text-xs">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="border-b border-border last:border-0">
                  {table.getVisibleLeafColumns().map((column) => (
                    <td key={column.id} className="px-4 py-3">
                      <div className="h-4 w-full max-w-32 animate-pulse rounded bg-surface-muted" />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors last:border-0 hover:bg-surface-muted"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>

        {showEmpty && <div className="p-6">{emptyState ?? <DefaultEmpty />}</div>}
      </div>

      {/* Vista de tarjetas para `< md`: una tarjeta por fila con cada columna como par
          etiqueta/valor, y la columna de acciones (la que se identifica por `header: ''` en la
          convención del proyecto) al final, sin etiqueta, como fila de botones. */}
      <div className="flex flex-col gap-3 md:hidden">
        {isLoading &&
          Array.from({ length: 3 }).map((_, cardIndex) => (
            <div
              key={`skeleton-card-${cardIndex}`}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              {Array.from({ length: 3 }).map((__, lineIndex) => (
                <div
                  key={lineIndex}
                  className="h-4 w-full max-w-48 animate-pulse rounded bg-surface-muted"
                />
              ))}
            </div>
          ))}

        {!isLoading &&
          rows.map((row) => {
            const cells = row.getVisibleCells()
            const fields = cells.filter((cell) => headerLabel(cell.column.columnDef) !== '')
            const actionCells = cells.filter((cell) => headerLabel(cell.column.columnDef) === '')
            return (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
              >
                <dl className="flex flex-col gap-2">
                  {fields.map((cell) => (
                    <div key={cell.id} className="flex flex-col gap-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">
                        {headerLabel(cell.column.columnDef)}
                      </dt>
                      <dd className="text-sm text-foreground">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </dd>
                    </div>
                  ))}
                </dl>
                {actionCells.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {actionCells.map((cell) => (
                      <div key={cell.id} className="contents">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

        {showEmpty && (
          <div className="rounded-card border border-border bg-surface p-6">
            {emptyState ?? <DefaultEmpty />}
          </div>
        )}
      </div>

      {clientPageSize && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {table.getFilteredRowModel().rows.length} resultado
            {table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
            {isFetching && ' · actualizando…'}
          </p>
          <div className="flex items-center gap-1.5">
            <IconButton
              label="Anterior"
              icon={<ChevronLeftIcon />}
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            />
            <span className="px-2 text-sm text-muted-foreground">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <IconButton
              label="Siguiente"
              icon={<ChevronRightIcon />}
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DefaultEmpty() {
  return <p className="text-center text-sm text-muted-foreground">No hay resultados.</p>
}
