import { useNavigate } from 'react-router-dom'
import { Badge, Button } from '@/components/ui'
import type { FromSnapshotOut } from '@/lib/contracts'
import { summarizeCounts } from '../logic'
import { describeSkippedReason } from '../messages'
import type { SnapshotWizard } from '../use-snapshot-wizard'

/** Vista 7 — resultado de la creación y puente al gate de revisión (Plan 02). */
export function ResultStep({ wizard, result }: { wizard: SnapshotWizard; result: FromSnapshotOut }) {
  const navigate = useNavigate()
  const { model } = result

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xl" aria-hidden>
            ✅
          </span>
          <h2 className="text-lg font-semibold text-foreground">
            Blueprint «{model.name}» creado (v{model.current_version})
          </h2>
          {result.has_non_portable && (
            <Badge tone="warning">No portable — atado a {result.source_engine}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {result.total_versions ?? result.versions.length} versión(es) ·{' '}
          {result.statements_captured} sentencia(s) capturada(s)
          {result.data_tables_captured ? <> · {result.data_tables_captured} tabla(s) de datos</> : null}
        </p>
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
        Todas las versiones nacen <strong>sin aprobar</strong>. Debes revisar el SQL y aprobar cada
        una antes de poder aplicarlas.
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">Versiones creadas</p>
        <ol className="flex flex-col gap-2">
          {result.versions.map((version) => {
            const isData = version.kind === 'data'
            return (
              <li
                key={version.version}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <code className="font-mono text-xs text-muted-foreground">v{version.version}</code>
                  {isData ? (
                    <span title="Datos-semilla: atados al motor.">
                      <Badge tone="warning">🌱 datos</Badge>
                    </span>
                  ) : (
                    <Badge tone="info">🧱 esquema</Badge>
                  )}
                  <span className="truncate text-foreground">{version.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!isData && Object.keys(version.object_counts).length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {summarizeCounts(version.object_counts)}
                    </span>
                  )}
                  {version.has_non_portable && !isData && <Badge tone="warning">no portable</Badge>}
                  <Badge tone="neutral">pendiente de revisión</Badge>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {result.skipped_tables.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">
            Tablas omitidas ({result.skipped_tables.length})
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2">Tabla</th>
                  <th className="p-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped_tables.map((skipped) => (
                  <tr key={skipped.table} className="border-t border-border">
                    <td className="p-2">
                      <code className="font-mono text-xs text-foreground">{skipped.table}</code>
                    </td>
                    <td className="p-2 text-muted-foreground">{describeSkippedReason(skipped.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={wizard.reset}>
          Crear otro
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/database-models')}>
            Ir a blueprints
          </Button>
          <Button onClick={() => navigate(`/database-models/${model.id}/migrations`)}>
            Revisar y aprobar versiones →
          </Button>
        </div>
      </div>
    </div>
  )
}
