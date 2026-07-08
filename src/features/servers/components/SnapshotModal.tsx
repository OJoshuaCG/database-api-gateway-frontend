import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, ErrorState, Modal, Spinner } from '@/components/ui'
import { NON_PORTABLE_OBJECT_TYPES, type DumpObjectType, type DumpStatement } from '@/lib/contracts'
import { useDatabaseSnapshot } from '../hooks/use-snapshot'

interface SnapshotModalProps {
  serverId: number
  database: string | null
  onClose: () => void
}

const TYPE_LABELS: Record<DumpObjectType, string> = {
  table: 'Tablas',
  view: 'Vistas',
  materialized_view: 'Vistas materializadas',
  routine: 'Rutinas',
  trigger: 'Triggers',
  sequence: 'Secuencias',
  type: 'Tipos',
  extension: 'Extensiones',
  index: 'Índices',
  event: 'Eventos',
}

/**
 * Visor de snapshot estructural de una BD (Plan 09 §5). Agrupa el DDL por tipo de objeto en
 * bloques colapsables, avisa si hay objetos no portables y permite guardarlo como blueprint
 * baseline (§6). Solo estructura, nunca datos.
 */
export function SnapshotModal({ serverId, database, onClose }: SnapshotModalProps) {
  const open = database !== null
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useDatabaseSnapshot(serverId, database, open)

  const grouped = useMemo(() => {
    const map = new Map<DumpObjectType, DumpStatement[]>()
    for (const stmt of data?.statements ?? []) {
      const list = map.get(stmt.object_type) ?? []
      list.push(stmt)
      map.set(stmt.object_type, list)
    }
    return [...map.entries()]
  }, [data])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Snapshot de ${database ?? ''}`}
      description="Estructura completa en orden de dependencia. Solo estructura, nunca filas."
      size="lg"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Capturando estructura…
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{data.source_engine}</Badge>
            <Badge tone="neutral">{data.statements.length} sentencia(s)</Badge>
            {data.has_non_portable && (
              <Badge tone="warning">🔒 contiene objetos no portables</Badge>
            )}
          </div>

          {data.has_non_portable && (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
              Incluye procedimientos/triggers/eventos: si lo guardas como blueprint, quedará atado
              al motor <strong>{data.source_engine}</strong> y no podrá aplicarse a otro motor.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {grouped.map(([type, statements]) => {
              const procedural = NON_PORTABLE_OBJECT_TYPES.has(type)
              return (
                <details key={type} className="rounded-lg border border-border p-3">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                    {TYPE_LABELS[type]} ({statements.length})
                    {procedural && <Badge tone="warning">no portable</Badge>}
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {statements.map((stmt) => (
                      <div key={`${type}:${stmt.name}`} className="flex flex-col gap-1">
                        <code className="text-xs text-muted-foreground">{stmt.name}</code>
                        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground">
                          {stmt.ddl}
                        </pre>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              onClick={() =>
                navigate(
                  `/database-models/from-snapshot?serverId=${serverId}&database=${encodeURIComponent(
                    database ?? '',
                  )}`,
                )
              }
              disabled={data.statements.length === 0}
            >
              Crear blueprint desde snapshot ▸
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
