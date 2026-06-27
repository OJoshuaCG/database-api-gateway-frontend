import { PAGINATION } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { Button } from './Button'

/**
 * Opciones de "por página" recortadas al `size` máximo que admite la API
 * (`PAGINATION.maxSize` ← `VITE_MAX_PAGE_SIZE`). Nunca ofrece un valor que el
 * backend rechazaría con 422, y garantiza que el propio máximo sea elegible.
 */
const DEFAULT_SIZE_OPTIONS = Array.from(new Set([10, 20, 50, 100, PAGINATION.maxSize]))
  .filter((option) => option <= PAGINATION.maxSize)
  .sort((a, b) => a - b)

export interface PaginationProps {
  page: number
  pages: number
  total: number
  size: number
  hasNext: boolean
  hasPrev: boolean
  onPageChange: (page: number) => void
  onSizeChange?: (size: number) => void
  sizeOptions?: number[]
  isFetching?: boolean
}

/** Controles de paginación server-side (page/size del backend, §3). */
export function Pagination({
  page,
  pages,
  total,
  size,
  hasNext,
  hasPrev,
  onPageChange,
  onSizeChange,
  sizeOptions = DEFAULT_SIZE_OPTIONS,
  isFetching,
}: PaginationProps) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Página {page} de {Math.max(pages, 1)} · {total} resultado{total === 1 ? '' : 's'}
        {isFetching && ' · actualizando…'}
      </p>
      <div className="flex items-center gap-3">
        {onSizeChange && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Por página
            <select
              value={size}
              onChange={(event) => onSizeChange(Number(event.target.value))}
              className={cn(
                'h-9 rounded-lg border border-input bg-surface px-2 text-sm text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {sizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  )
}
