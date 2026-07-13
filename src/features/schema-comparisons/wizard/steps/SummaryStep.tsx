import { Badge, Button, Spinner } from '@/components/ui'
import { compositionRows } from '../logic'
import { DiffCompositionChart } from '../DiffCompositionChart'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/** Vista 2 — resumen del diff: conteos, advertencias y las dos ramas de acción mutuamente excluyentes. */
export function SummaryStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const { summary } = wizard

  if (summary.isLoading && !summary.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando resumen…
      </div>
    )
  }

  if (summary.isError && !summary.data) {
    return (
      <ErrorRecoveryPanel
        error={summary.error}
        title="No se pudo cargar el resumen"
        onRecalculate={wizard.recalculate}
        isRecovering={wizard.createComparisonState.isPending}
      />
    )
  }

  if (!summary.data) return null
  const data = summary.data

  // Los nombres físicos SIEMPRE vienen poblados (adoptada o cruda); nunca depender de un detalle
  // en vivo que no existe para una BD sin registrar.
  const sourceName = data.source_database_name
  const targetName = data.target_database_name
  // `actionEntryStep` ya resuelve la rama con la regla completa (target sin inventario → solo B;
  // target en inventario → según su blueprint). Si sigue `null` aquí es porque el target SÍ está
  // en inventario y su detalle todavía se está resolviendo.
  const branchLoading = wizard.actionEntryStep === null
  const hasBlueprint = wizard.actionEntryStep === 'adoptSelect'

  if (data.item_count === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">
          Diff: {sourceName} → {targetName}
        </h2>
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          ✅ Las dos bases de datos son estructuralmente iguales. No hay nada que sincronizar.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          Diff: {sourceName} → {targetName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Motor: {data.source_engine} → {data.target_engine}
        </p>
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-foreground">
          DDL = qué correr en <strong>TARGET</strong> ({targetName}) para igualar <strong>SOURCE</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          {data.cross_flavor_warning && <Badge tone="warning">⚠ Cross-flavor MySQL↔MariaDB</Badge>}
          {data.has_destructive && <Badge tone="error">🔴 Contiene cambios destructivos</Badge>}
          {data.expired && <Badge tone="error">⏳ Expirada</Badge>}
        </div>
        {data.scope_note && (
          <p className="rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
            ℹ {data.scope_note}
          </p>
        )}
      </div>

      {data.expired ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-error/30 bg-error/5 p-4">
          <p className="text-sm text-foreground">
            La comparación expiró; vuelve a calcularla para obtener el estado actual del target.
          </p>
          <Button onClick={wizard.recalculate} isLoading={wizard.createComparisonState.isPending}>
            Recalcular
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Composición del diff</p>
            <DiffCompositionChart counts={data.counts} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2">Tipo</th>
                    <th className="p-2">Nuevos</th>
                    <th className="p-2">Modificados</th>
                    <th className="p-2">Eliminados</th>
                  </tr>
                </thead>
                <tbody>
                  {compositionRows(data.counts).map((row) => (
                    <tr key={row.objectType} className="border-t border-border">
                      <td className="p-2 text-foreground">{row.label}</td>
                      <td className="p-2 text-muted-foreground">{row.new || '—'}</td>
                      <td className="p-2 text-muted-foreground">{row.modified || '—'}</td>
                      <td className="p-2 text-muted-foreground">{row.dropped || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Total de sentencias: <strong>{data.item_count}</strong>. La tabla cuenta OBJETOS; un
              mismo objeto puede generar varias sentencias (p. ej. varios <code>ALTER COLUMN</code>).
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('items')}>
              Ver detalle del DDL →
            </Button>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={hasBlueprint ? '' : 'opacity-60'}>
                <Button
                  className="w-full"
                  disabled={!hasBlueprint || branchLoading}
                  isLoading={branchLoading && wizard.targetDetail.fetchStatus === 'fetching'}
                  onClick={() => wizard.goToStep('adoptSelect')}
                >
                  Adoptar como versión del blueprint →
                </Button>
                {!branchLoading && !hasBlueprint && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bloqueado: el target no tiene blueprint asignado.
                  </p>
                )}
              </div>
              <div className={!hasBlueprint ? '' : 'opacity-60'}>
                <Button
                  className="w-full"
                  disabled={hasBlueprint || branchLoading}
                  isLoading={branchLoading && wizard.targetDetail.fetchStatus === 'fetching'}
                  onClick={() => wizard.goToStep('executeSelect')}
                >
                  Ejecutar sobre el target →
                </Button>
                {!branchLoading && hasBlueprint && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bloqueado: el target tiene blueprint; usa «Adoptar como versión».
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

