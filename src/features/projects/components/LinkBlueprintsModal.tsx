import { useMemo, useState } from 'react'
import { Button, Checkbox, EmptyState, ErrorState, Input, Modal, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  PAGINATION,
  PROJECT_ERROR_CODES,
  type ProjectBlueprintsLinkOut,
  type ProjectOut,
} from '@/lib/contracts'
// Import por ruta directa y NO por el barrel, a propósito: `database-models` importa
// `ProjectsPanel` desde el barrel de esta feature para montar sus pestañas, así que pasar por el
// barrel contrario cerraría un ciclo entre los dos módulos. El hook es un módulo hoja y no
// reentra en ninguno de los dos barrels.
import { useDatabaseModels } from '@/features/database-models/hooks/use-database-models'
import { useLinkProjectBlueprints } from '../hooks/use-projects'

/** Cuántos blueprints se piden de entrada, y cuántos suma cada «Cargar más». */
const PAGE_STEP = 50

interface LinkBlueprintsModalProps {
  open: boolean
  onClose: () => void
  project: ProjectOut
  /** Ids ya vinculados: se muestran marcados y deshabilitados, nunca ocultos. */
  linkedIds: number[]
  /** Resultado del 200. Lo comunica el padre, que es quien sigue en pantalla al cerrarse esto. */
  onLinked: (result: ProjectBlueprintsLinkOut) => void
}

/**
 * Selector de blueprints para vincular a un proyecto (§3.7).
 *
 * Dos decisiones que vienen de que la operación sea **idempotente y todo-o-nada**:
 *
 * - Los ya vinculados se muestran **marcados y deshabilitados**, no se ocultan: verlos evita que
 *   el usuario crea que el catálogo está incompleto.
 * - Se manda la **selección completa** sin calcular el delta en cliente. Los que ya pertenecían
 *   vuelven en `already_linked` con 200, y eso es **éxito**: es lo que hace que la llamada se
 *   pueda repetir sin consecuencias. El backend además deduplica.
 *
 * La carga es incremental subiendo el `size` en vez de acumular páginas en estado: con
 * `keepPreviousData` la lista anterior sigue en pantalla mientras llega la más larga, y no hace
 * falta un array acumulador que sincronizar. `GET /database-models` no tiene búsqueda en
 * servidor, así que el filtro es local — y el texto lo dice, porque un buscador que parece
 * global pero solo mira lo cargado es peor que no tener buscador.
 */
export function LinkBlueprintsModal({
  open,
  onClose,
  project,
  linkedIds,
  onLinked,
}: LinkBlueprintsModalProps) {
  const [size, setSize] = useState(PAGE_STEP)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  /** Ids que el 422 marcó como inexistentes: se señalan en su fila, no invalidan la selección. */
  const [missingIds, setMissingIds] = useState<number[]>([])
  /**
   * Banner del selector. El CTA va DECLARADO en el estado, no deducido del texto: los dos 409 de
   * este módulo piden acciones opuestas —`link_conflict` se resuelve repitiendo la llamada,
   * `name_taken` cambiando un dato— y deducirlo de la prosa es exactamente el acoplamiento que
   * `public_context.code` viene a eliminar.
   */
  const [banner, setBanner] = useState<{
    tone: 'error' | 'warning'
    text: string
    retry: 'valid' | 'same' | null
  } | null>(null)

  const catalog = useDatabaseModels({ page: 1, size })
  const link = useLinkProjectBlueprints(project.id)

  const linked = useMemo(() => new Set(linkedIds), [linkedIds])

  // La dependencia es `catalog.data`, que sí es estable entre renders: un `?? []` suelto crearía
  // un array nuevo cada vez y el memo de abajo no llegaría a servir de nada.
  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (needle === '') return items
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle),
    )
  }, [items, filter])

  const toggle = (id: number) => {
    setMissingIds((prev) => prev.filter((missing) => missing !== id))
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  const submit = (ids: number[]) => {
    setBanner(null)
    link.mutate(ids, {
      onSuccess: (result) => {
        setMissingIds([])
        // El resultado se entrega al padre y este panel se cierra: pintarlo aquí sería escribir
        // en una pantalla que desaparece en el mismo tick.
        onClose()
        onLinked(result)
      },
      onError: (error) => {
        const apiError = toApiError(error)
        if (apiError.code === PROJECT_ERROR_CODES.blueprintsNotFound) {
          const missing = apiError.missingModelIds ?? []
          setMissingIds(missing)
          // Se desmarcan solos: la selección corregida es la que el CTA va a reenviar.
          setSelected((prev) => prev.filter((id) => !missing.includes(id)))
          setBanner({
            tone: 'error',
            text: `No se vinculó ninguno. ${missing.length} blueprint(s) de la selección ya no existen y están marcados abajo. Quítalos y vuelve a intentar.`,
            retry: 'valid',
          })
          return
        }
        if (apiError.code === PROJECT_ERROR_CODES.linkConflict) {
          // Transitorio: se resuelve REPITIENDO la misma llamada. Por eso la selección se
          // mantiene intacta y el CTA es reintentar, no corregir nada.
          setBanner({
            tone: 'warning',
            text: 'Otra operación vinculó blueprints al mismo tiempo. Vuelve a intentarlo: la operación es segura de repetir.',
            retry: 'same',
          })
          return
        }
        if (apiError.code === PROJECT_ERROR_CODES.notFound) {
          setBanner({ tone: 'error', text: 'Este proyecto ya no existe.', retry: null })
          return
        }
        setBanner({ tone: 'error', text: apiError.message, retry: null })
      },
    })
  }

  const hasNext = catalog.data?.pagination.has_next ?? false
  const canLoadMore = hasNext && size < PAGINATION.maxSize

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Agregar blueprints a ${project.name}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{selected.length} seleccionado(s)</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={link.isPending}>
              Cancelar
            </Button>
            <Button
              isLoading={link.isPending}
              disabled={selected.length === 0}
              onClick={() => submit(selected)}
            >
              Agregar al proyecto
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Input
            placeholder="Filtrar por nombre o slug"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            El catálogo se carga por páginas; el filtro aplica a lo cargado.
          </span>
        </div>

        {banner && (
          <div
            role="alert"
            className={
              banner.tone === 'error'
                ? 'flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error'
                : 'flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-warning'
            }
          >
            <span>{banner.text}</span>
            {banner.retry !== null && selected.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => submit(selected)}>
                {banner.retry === 'valid' ? 'Reintentar solo con los válidos' : 'Reintentar'}
              </Button>
            )}
          </div>
        )}

        {catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : catalog.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando el catálogo de blueprints…
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="No hay blueprints en el gateway todavía." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected((prev) => {
                    const selectable = visible
                      .filter((item) => !linked.has(item.id))
                      .map((item) => item.id)
                    return Array.from(new Set([...prev, ...selectable]))
                  })
                }
              >
                Seleccionar todo lo visible
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Limpiar selección
              </Button>
            </div>

            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {visible.map((item) => {
                const isLinked = linked.has(item.id)
                const isMissing = missingIds.includes(item.id)
                return (
                  <li
                    key={item.id}
                    className={
                      isMissing
                        ? 'rounded-md border border-error/40 bg-error/5 px-2 py-1'
                        : 'rounded-md px-2 py-1'
                    }
                  >
                    <Checkbox
                      label={`${item.name} (${item.slug}) — versión ${item.current_version}`}
                      hint={isMissing ? 'Este blueprint ya no existe' : undefined}
                      checked={isLinked || selected.includes(item.id)}
                      disabled={isLinked}
                      onChange={() => toggle(item.id)}
                    />
                    {isLinked && (
                      <span className="ml-7 text-xs text-muted-foreground">Ya en el proyecto</span>
                    )}
                  </li>
                )
              })}
            </ul>

            {canLoadMore && (
              <Button
                variant="outline"
                size="sm"
                isLoading={catalog.isFetching}
                onClick={() => setSize((prev) => Math.min(prev + PAGE_STEP, PAGINATION.maxSize))}
              >
                Cargar más
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
