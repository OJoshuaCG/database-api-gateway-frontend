import { useMemo, useState } from 'react'
import { Badge, Button, ErrorState, Modal, Spinner, Switch } from '@/components/ui'
import {
  NON_PORTABLE_OBJECT_TYPES,
  type DumpObjectType,
  type DumpStatement,
} from '@/lib/contracts'
import { OBJECT_TYPE_LABELS, snapshotObjectCounts, summarizeCounts, TYPE_ORDER } from '../logic'
import { ObjectCompositionChart } from '../ObjectCompositionChart'
import type { SnapshotWizard } from '../use-snapshot-wizard'

/** Vista 2 — explorador de la estructura capturada, con camino express y avanzado. */
export function PreviewStep({ wizard }: { wizard: SnapshotWizard }) {
  const { snapshot } = wizard
  const [search, setSearch] = useState('')
  const [ddlOf, setDdlOf] = useState<DumpStatement | null>(null)

  const dump = snapshot.data
  const counts = useMemo(() => (dump ? snapshotObjectCounts(dump) : {}), [dump])

  const grouped = useMemo(() => {
    const map = new Map<DumpObjectType, DumpStatement[]>()
    const query = search.trim().toLowerCase()
    for (const stmt of dump?.statements ?? []) {
      if (query && !stmt.name.toLowerCase().includes(query)) continue
      const list = map.get(stmt.object_type) ?? []
      list.push(stmt)
      map.set(stmt.object_type, list)
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const)
  }, [dump, search])

  if (snapshot.isLoading && !dump) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Leyendo la estructura del motor en vivo…
      </div>
    )
  }

  if (snapshot.isError && !dump) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          error={snapshot.error}
          onRetry={() => void snapshot.refetch()}
          title="No se pudo leer la estructura"
        />
        <div className="flex justify-start border-t border-border pt-4">
          <Button variant="ghost" onClick={wizard.back}>
            ← Cambiar origen
          </Button>
        </div>
      </div>
    )
  }

  if (!dump) return null

  const isEmpty = dump.statements.length === 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            Estructura de <code className="font-mono">{dump.database}</code>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{dump.source_engine}</Badge>
            <Badge tone="neutral">{dump.statements.length} sentencia(s)</Badge>
            {dump.has_non_portable && (
              <span title={`Incluye rutinas/triggers/events → atado a ${dump.source_engine}.`}>
                <Badge tone="warning">🔒 No portable</Badge>
              </span>
            )}
          </div>
        </div>
        <Switch
          checked={wizard.includeDataStats}
          onCheckedChange={wizard.setIncludeDataStats}
          label="Incluir estadísticas de datos"
          hint={snapshot.isFetching && wizard.includeDataStats ? 'Cargando…' : 'Para elegir catálogos'}
        />
      </div>

      {isEmpty ? (
        <div className="rounded-card border border-warning/30 bg-warning/5 p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Esta base de datos no tiene objetos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No hay estructura que capturar. Elige otro origen.
          </p>
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={wizard.back}>
              ← Cambiar origen
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">Composición ({summarizeCounts(counts)})</p>
              <ObjectCompositionChart counts={counts} />
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar objeto por nombre…"
                className="h-9 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
                {grouped.map(([type, statements]) => (
                  <details key={type} className="rounded-lg border border-border p-2">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                      {OBJECT_TYPE_LABELS[type]} ({statements.length})
                      {NON_PORTABLE_OBJECT_TYPES.has(type) && <Badge tone="warning">no portable</Badge>}
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {statements.map((stmt) => (
                        <li
                          key={stmt.name}
                          className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs"
                        >
                          <span className="flex min-w-0 flex-col">
                            <code className="truncate font-mono text-foreground">{stmt.name}</code>
                            {stmt.depends_on.length > 0 && (
                              <span className="truncate text-muted-foreground">
                                depende de: {stmt.depends_on.join(', ')}
                              </span>
                            )}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => setDdlOf(stmt)}>
                            Ver DDL
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          </div>

          {dump.has_non_portable && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              Incluye procedimientos/triggers/eventos: el blueprint quedará atado al motor{' '}
              <strong>{dump.source_engine}</strong> y no podrá aplicarse a otro motor. Puedes
              excluirlos en el siguiente paso.
            </p>
          )}
        </>
      )}

      <Modal
        open={ddlOf !== null}
        onClose={() => setDdlOf(null)}
        title={ddlOf ? `DDL · ${ddlOf.name}` : 'DDL'}
        description="Solo lectura. El SQL de las versiones creadas se revisa en la vista de migraciones."
        size="lg"
      >
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground">
          {ddlOf?.ddl}
        </pre>
      </Modal>
    </div>
  )
}
