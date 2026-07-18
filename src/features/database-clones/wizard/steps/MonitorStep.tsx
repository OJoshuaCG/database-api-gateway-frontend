import { Badge, Button, ErrorState, Pagination, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ClonePhase, CloneItemStatus } from '@/lib/contracts'
import type { DatabaseCloneWizard } from '../use-database-clone-wizard'

const PHASE_ORDER: ClonePhase[] = ['clean', 'structure', 'data', 'adopt', 'done']
const PHASE_LABELS: Record<ClonePhase, string> = {
  clean: 'Limpieza',
  structure: 'Estructura',
  data: 'Datos',
  adopt: 'Adopción',
  done: 'Listo',
}

const ITEM_STATUS_TONE: Record<CloneItemStatus, 'neutral' | 'success' | 'error' | 'warning'> = {
  pending: 'neutral',
  applied: 'success',
  failed: 'error',
  skipped: 'warning',
}

function PhaseBar({ phase }: { phase: ClonePhase | null }) {
  const currentIndex = phase ? PHASE_ORDER.indexOf(phase) : -1
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {PHASE_ORDER.map((step, index) => (
        <li
          key={step}
          className={cn(
            'rounded-full border px-3 py-1 font-medium',
            index === currentIndex
              ? 'border-primary bg-primary/10 text-primary'
              : index < currentIndex
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-muted-foreground',
          )}
        >
          {PHASE_LABELS[step]}
        </li>
      ))}
    </ol>
  )
}

/**
 * Vista 6 — monitor de ejecución: sigue el job en segundo plano por polling de `GET /{id}` y el
 * detalle de pasos por `GET /{id}/items`. Sin websockets: el polling es el único mecanismo.
 */
export function MonitorStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { job, items } = wizard

  if (job.isLoading && !job.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando estado del job…
      </div>
    )
  }
  if (job.isError && !job.data) {
    return <ErrorState error={job.error} title="No se pudo cargar el estado del clon" />
  }
  const data = job.data
  if (!data) return null

  const canCancel = data.status === 'pending' || data.status === 'running'
  const tableProgress = Object.entries(data.progress?.tables ?? {})

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            Clonando {data.source_database_name} → {data.target_database_name}
          </h2>
          {canCancel && (
            <Button variant="outline" onClick={wizard.cancelClone} isLoading={wizard.cancel.isPending}>
              Cancelar
            </Button>
          )}
        </div>
        <PhaseBar phase={data.phase} />
      </div>

      {data.include_data && data.phase === 'data' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Progreso de datos
          </p>
          {tableProgress.length === 0 ? (
            <p className="text-xs text-muted-foreground">Copiando…</p>
          ) : (
            tableProgress.map(([table, rows]) => (
              <div key={table} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm">
                <span className="text-foreground">{table}</span>
                <span className="text-muted-foreground">{rows} filas</span>
              </div>
            ))
          )}
        </div>
      )}

      {data.status === 'succeeded' && (
        <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 p-4">
          <p className="text-sm font-semibold text-foreground">✅ Clon completado</p>
          <Button variant="outline" className="self-start" onClick={wizard.reset}>
            Nuevo clon
          </Button>
        </div>
      )}
      {data.status === 'failed' && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/30 bg-error/5 p-4">
          <p className="text-sm font-semibold text-foreground">🔴 La clonación falló</p>
          {data.error && <p className="text-sm text-muted-foreground">{data.error}</p>}
          <p className="text-xs text-muted-foreground">
            Si el destino era una BD gestionada, quedó en cuarentena hasta que se revise.
          </p>
          <Button variant="outline" className="self-start" onClick={wizard.replan}>
            Replanear
          </Button>
        </div>
      )}
      {data.status === 'interrupted' && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">⚠ El proceso se reinició a mitad</p>
          <p className="text-xs text-muted-foreground">Los jobs no son durables: replanea y reejecuta.</p>
          <Button variant="outline" className="self-start" onClick={wizard.replan}>
            Replanear
          </Button>
        </div>
      )}
      {data.status === 'canceled' && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">⏹ Cancelado</p>
          <p className="text-xs text-muted-foreground">Revisa los pasos ya aplicados abajo.</p>
          <Button variant="outline" className="self-start" onClick={wizard.reset}>
            Nuevo clon
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pasos ejecutados</p>
        {items.isLoading && !items.data ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Cargando pasos…
          </div>
        ) : items.isError ? (
          <ErrorState error={items.error} title="No se pudieron cargar los pasos" />
        ) : items.data && items.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Seq</th>
                    <th className="px-3 py-2 font-semibold">Paso</th>
                    <th className="px-3 py-2 font-semibold">Objeto</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2 font-semibold">Filas</th>
                    <th className="px-3 py-2 font-semibold">ms</th>
                    <th className="px-3 py-2 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{item.seq}</td>
                      <td className="px-3 py-2">{item.kind}</td>
                      <td className="px-3 py-2 text-foreground">
                        {item.object_type} · {item.object_name}
                      </td>
                      <td className="px-3 py-2">
                        {item.status ? (
                          <Badge tone={ITEM_STATUS_TONE[item.status]}>{item.status}</Badge>
                        ) : (
                          <Badge tone="neutral">pendiente</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{item.rows_copied ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.execution_ms ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={items.data.pagination.page}
              pages={items.data.pagination.pages}
              total={items.data.pagination.total}
              size={items.data.pagination.size}
              hasNext={items.data.pagination.has_next}
              hasPrev={items.data.pagination.has_prev}
              onPageChange={wizard.setItemsPage}
              isFetching={items.isFetching}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Aún no hay pasos registrados.</p>
        )}
      </div>
    </div>
  )
}
