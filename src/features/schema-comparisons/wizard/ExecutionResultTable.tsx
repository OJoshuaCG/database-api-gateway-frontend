import { Badge } from '@/components/ui'
import type { SchemaComparisonExecutionStatus, SchemaComparisonStatementResult } from '@/lib/contracts'
import { OBJECT_TYPE_LABELS } from './logic'

const STATUS_TONE: Record<SchemaComparisonExecutionStatus, 'success' | 'error' | 'neutral'> = {
  applied: 'success',
  failed: 'error',
  skipped: 'neutral',
}

const STATUS_LABEL: Record<SchemaComparisonExecutionStatus, string> = {
  applied: 'Aplicada',
  failed: 'Falló',
  skipped: 'Omitida',
}

/** Tabla de resultado por sentencia de `POST .../execute` (Vista 6B). */
export function ExecutionResultTable({
  statements,
}: {
  statements: SchemaComparisonStatementResult[]
}) {
  if (statements.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-2">Objeto</th>
            <th className="p-2">Tipo</th>
            <th className="p-2">Estado</th>
            <th className="p-2">ms</th>
            <th className="p-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {statements.map((statement) => (
            <tr key={statement.item_id} className="border-t border-border">
              <td className="p-2">
                <code className="font-mono text-xs text-foreground">{statement.object_name}</code>
              </td>
              <td className="p-2 text-muted-foreground">{OBJECT_TYPE_LABELS[statement.object_type]}</td>
              <td className="p-2">
                <Badge tone={STATUS_TONE[statement.status]}>{STATUS_LABEL[statement.status]}</Badge>
              </td>
              <td className="p-2 text-muted-foreground">{statement.execution_ms}</td>
              <td className="p-2 text-error">{statement.error ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
