import { useMemo } from 'react'
import { Badge, Button, Input } from '@/components/ui'
import type { DumpObjectType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { objectKey, OBJECT_TYPE_LABELS, TYPE_ORDER } from '../logic'
import type { SnapshotWizard } from '../use-snapshot-wizard'

/** Vista 5 — constructor de layout manual (buckets de esquema ordenados). */
export function ManualLayoutStep({ wizard }: { wizard: SnapshotWizard }) {
  const { selectedStatements } = wizard
  const grouped = useMemo(() => {
    const map = new Map<DumpObjectType, typeof selectedStatements>()
    for (const stmt of selectedStatements) {
      const list = map.get(stmt.object_type) ?? []
      list.push(stmt)
      map.set(stmt.object_type, list)
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const)
  }, [selectedStatements])

  const hasProblems = wizard.manualProblems.length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Layout manual</h2>
          <p className="text-sm text-muted-foreground">
            Asigna cada objeto a una versión. El orden de las versiones fija su número.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={wizard.reseedByClass}>
            Reasignar por clase
          </Button>
          <Button variant="outline" size="sm" onClick={wizard.addSchemaBucket}>
            + Añadir versión
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Panel izquierdo: objetos disponibles */}
        <div className="flex max-h-[28rem] flex-col gap-3 overflow-auto rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">Objetos ({wizard.selectedStatements.length})</p>
          {grouped.map(([type, list]) => (
            <div key={type} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {OBJECT_TYPE_LABELS[type]}
              </p>
              {list.map((stmt) => {
                const key = objectKey(stmt)
                const bucketId = wizard.bucketOfObject.get(key) ?? ''
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm',
                      bucketId ? 'border-border' : 'border-warning/40 bg-warning/5',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <code className="truncate font-mono text-xs text-foreground">{stmt.name}</code>
                      {stmt.depends_on.length > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          ← {stmt.depends_on.join(', ')}
                        </span>
                      )}
                    </span>
                    <select
                      value={bucketId}
                      onChange={(event) =>
                        event.target.value
                          ? wizard.assignObject(key, event.target.value)
                          : wizard.unassignObject(key)
                      }
                      className="h-8 shrink-0 rounded-md border border-input bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`Asignar ${stmt.name} a una versión`}
                    >
                      <option value="">Sin asignar</option>
                      {wizard.manualBuckets.map((bucket, index) => (
                        <option key={bucket.id} value={bucket.id}>
                          v{index + 1} · {bucket.name || 'Sin nombre'}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Panel derecho: versiones (buckets) */}
        <div className="flex max-h-[28rem] flex-col gap-3 overflow-auto rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">Versiones ({wizard.manualBuckets.length})</p>
          {wizard.manualBuckets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Añade una versión para empezar a asignar objetos.
            </p>
          )}
          {wizard.manualBuckets.map((bucket, index) => (
            <div key={bucket.id} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs text-muted-foreground">v{index + 1}</code>
                <Input
                  value={bucket.name}
                  maxLength={200}
                  onChange={(event) => wizard.renameBucket(bucket.id, event.target.value)}
                  placeholder="Nombre de la versión"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => wizard.moveBucket(bucket.id, -1)}
                  disabled={index === 0}
                  aria-label="Subir versión"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => wizard.moveBucket(bucket.id, 1)}
                  disabled={index === wizard.manualBuckets.length - 1}
                  aria-label="Bajar versión"
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => wizard.removeBucket(bucket.id)}
                  aria-label="Eliminar versión"
                >
                  ✕
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bucket.objectKeys.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Vacía</span>
                ) : (
                  bucket.objectKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => wizard.unassignObject(key)}
                      className="flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:border-error/40"
                      title="Quitar de esta versión"
                    >
                      <code className="font-mono">{key.split(':').slice(1).join(':')}</code>
                      <span aria-hidden>✕</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasProblems ? (
        <div className="flex flex-col gap-2 rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="text-sm font-semibold text-error">
            Corrige {wizard.manualProblems.length} problema(s) antes de continuar
          </p>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {wizard.manualProblems.map((problem, index) => (
              <li key={`${problem.reason}-${index}`} className="flex items-start gap-2">
                <span aria-hidden className="text-error">
                  •
                </span>
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-success">
          <Badge tone="success">✓</Badge> Layout válido en cliente. El backend hará la validación
          topológica completa.
        </p>
      )}
    </div>
  )
}
