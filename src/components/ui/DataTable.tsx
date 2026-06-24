import { useMemo, useState, type ReactNode } from 'react'
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
import { Input } from './Input'
import { MultiCombobox } from './MultiCombobox'

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
            <div className="w-full sm:max-w-xs">
              <MultiCombobox<ColumnOption>
                items={hideableColumns}
                selectedItems={visibleColumnOptions}
                onChange={(selected) => {
                  const visibleIds = new Set(selected.map((option) => option.id))
                  const next: VisibilityState = {}
                  for (const option of hideableColumns) next[option.id] = visibleIds.has(option.id)
                  setColumnVisibility(next)
                }}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.id}
                placeholder="Columnas visibles"
              />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
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

      {clientPageSize && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {table.getFilteredRowModel().rows.length} resultado
            {table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
            {isFetching && ' · actualizando…'}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="rounded-lg border border-input bg-surface px-3 py-1.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Anterior
            </button>
            <span className="px-2 text-sm text-muted-foreground">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="rounded-lg border border-input bg-surface px-3 py-1.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DefaultEmpty() {
  return <p className="text-center text-sm text-muted-foreground">No hay resultados.</p>
}
