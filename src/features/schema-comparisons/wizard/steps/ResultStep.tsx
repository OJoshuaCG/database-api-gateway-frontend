import { useNavigate } from 'react-router-dom'
import { Badge, Button } from '@/components/ui'
import { ExecutionResultTable } from '../ExecutionResultTable'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/** Vista 6 — resultado de la adopción (6A) o de la ejecución (6B). */
export function ResultStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const navigate = useNavigate()
  const { result } = wizard
  if (!result) return null

  if (result.kind === 'adopt') {
    const { data } = result
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xl" aria-hidden>
            ✅
          </span>
          <h2 className="text-lg font-semibold text-foreground">
            Versión {data.version} adoptada al blueprint #{data.model_id}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{data.statements} sentencia(s) incluida(s).</p>

        {!data.executed ? (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <Badge tone="warning" className="self-start">
              ⚠ Pendiente de revisión
            </Badge>
            <p className="text-sm text-foreground">
              La versión nace sin aprobar. Debes revisar el SQL y aprobarla (gate R1) antes de poder
              aplicarla a cualquier BD.
            </p>
            <Button
              className="self-start"
              onClick={() => navigate(`/database-models/${data.model_id}/migrations`)}
            >
              Revisar y aprobar la versión →
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 p-4">
            <Badge tone="success" className="self-start">
              ✅ Aplicada
            </Badge>
            {data.apply_result && (
              <p className="text-sm text-foreground">
                {data.apply_result.from_version ?? '—'} → {data.apply_result.to_version ?? '—'} ·{' '}
                {data.apply_result.applied_count} aplicada(s)
                {data.apply_result.quarantined && ' · quedó en cuarentena'}
                {data.apply_result.failed && ' · falló'}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={wizard.reset}>
            Nueva comparación
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(`/database-models/${data.model_id}/migrations`)}
          >
            Ver el blueprint
          </Button>
        </div>
      </div>
    )
  }

  const { data } = result
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl" aria-hidden>
          {data.failed ? '🔴' : '✅'}
        </span>
        <h2 className="text-lg font-semibold text-foreground">
          Ejecución sobre el target — {data.applied_count}/{data.total} aplicadas
        </h2>
      </div>
      {data.failed && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-foreground">
          🔴 Se detuvo en el primer fallo. Las sentencias posteriores no se ejecutaron. Corrige e
          inténtalo de nuevo (quizá recalculando la comparación si el target quedó en estado
          parcial).
        </p>
      )}
      <ExecutionResultTable statements={data.statements} />
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={wizard.reset}>
          Nueva comparación
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => wizard.goToStep('items')}>
            Ver detalle
          </Button>
          <Button onClick={wizard.recalculate} isLoading={wizard.createComparisonState.isPending}>
            Recalcular comparación
          </Button>
        </div>
      </div>
    </div>
  )
}
