import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui'
import { type EngineType, type QueryExecuteOut, type QueryErrorOut } from '@/lib/contracts'
import { cn, engineLabel } from '@/lib/utils'
import {
  executionSummary,
  MODE_OPTIONS,
  statementOutcome,
  type ExecutionTone,
  type StatementOutcome,
} from '../logic'
import { StatementResultCard } from './StatementResultCard'

export interface ResultsPanelProps {
  result: QueryExecuteOut
  engine: EngineType
}

/** Clases del encabezado por tono. El tono lo decide `executionSummary`, no esta capa. */
const SUMMARY_TONES: Record<ExecutionTone, string> = {
  success: 'border-success/30 bg-success/5',
  warning: 'border-warning/30 bg-warning/5',
  error: 'border-error/30 bg-error/10',
  neutral: 'border-border bg-surface-muted',
}

const SUMMARY_TITLE_TONES: Record<ExecutionTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-foreground',
}

/** Etiqueta y color del punto que resume cada pestaña de sentencia. */
const OUTCOME_MARKS: Record<StatementOutcome, { label: string; dot: string }> = {
  ok: { label: 'correcta', dot: 'bg-success' },
  // Neutro: un rechazo del motor es un resultado válido de la prueba, no un fallo.
  rejected: { label: 'rechazada por el motor', dot: 'bg-muted-foreground' },
  skipped: { label: 'no ejecutada', dot: 'bg-border' },
  'policy-miss': { label: 'fallo de clasificación del gateway', dot: 'bg-error' },
}

/**
 * Panel de resultados de una ejecución.
 *
 * El titular sale entero de `executionSummary`, que ya resuelve la prioridad correcta
 * (`ddl_persisted` → `policy_miss` → error de conexión → rechazo del motor → éxito) y con ella
 * el color. Reimplementar esa decisión aquí sería la forma más fácil de pintar de rojo un
 * rechazo por permisos, que es exactamente lo que el módulo NO debe hacer.
 */
export function ResultsPanel({ result, engine }: ResultsPanelProps) {
  const [selected, setSelected] = useState(0)
  const baseId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const summary = executionSummary(result)
  const statements = result.statements
  // Un resultado nuevo puede traer menos sentencias que el anterior: se acota en render en vez
  // de corregir el estado desde un efecto.
  const active = Math.min(selected, Math.max(0, statements.length - 1))
  // Un lote que ni llegó a conectar vuelve sin sentencias: entonces solo se muestra el titular.
  const activeStatement = statements[active] ?? null

  // Solo se pinta la tarjeta de la sentencia activa: un recorte en una pestaña no seleccionada
  // sería invisible, y un recorte silencioso lleva a conclusiones falsas. Se cuenta acá para
  // avisarlo en el encabezado y marcarlo en cada pestaña.
  const truncatedCount = statements.filter((statement) => statement.truncated).length

  // Patrón APG de pestañas: las flechas mueven selección Y foco (activación automática), con
  // vuelta circular en los extremos. Solo la pestaña activa entra en el orden de tabulación.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = (index + delta + statements.length) % statements.length
    setSelected(next)
    tabRefs.current[next]?.focus()
  }

  const modeLabel =
    MODE_OPTIONS.find((option) => option.mode === result.connection_mode)?.label ??
    result.connection_mode

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn('flex flex-col gap-1 rounded-card border p-4', SUMMARY_TONES[summary.tone])}
      >
        <p className={cn('text-base font-semibold', SUMMARY_TITLE_TONES[summary.tone])}>
          {summary.title}
        </p>
        <p className="text-sm text-foreground">{summary.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Ejecutado como <code className="font-mono text-foreground">{result.run_as}</code> (
          {modeLabel})
        </span>
        <span aria-hidden>·</span>
        <span>{engineLabel(engine)}</span>
        <span aria-hidden>·</span>
        <code className="font-mono text-foreground">{result.database}</code>
        <span className="flex flex-wrap items-center gap-1.5">
          {result.dry_run && <Badge tone="warning">Modo de prueba</Badge>}
          {result.read_only && <Badge tone="neutral">Solo lectura</Badge>}
          {result.committed && <Badge tone="success">Confirmado (COMMIT)</Badge>}
          {result.rolled_back && <Badge tone="neutral">Revertido (ROLLBACK)</Badge>}
          {result.ddl_persisted && <Badge tone="error">Estructura persistida</Badge>}
        </span>
        <span className="ml-auto">
          {/* `null` es válido: el registro del historial es best-effort y no bloquea nada. */}
          {result.execution_id == null
            ? 'Sin registro en el historial'
            : `Historial #${result.execution_id}`}
        </span>
      </div>

      {result.connection_error && (
        // Tono neutro a propósito: no poder conectar con la identidad elegida es el resultado
        // de la prueba, no una caída del sistema.
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3">
          <p className="text-sm font-medium text-foreground">
            No se pudo conectar como {result.run_as}
          </p>
          <ConnectionError error={result.connection_error} />
        </div>
      )}

      {truncatedCount > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-sm font-medium text-foreground">
            {truncatedCount === 1
              ? '1 sentencia devolvió resultados recortados'
              : `${truncatedCount} sentencias devolvieron resultados recortados`}
          </p>
          <p className="text-xs text-muted-foreground">
            No se muestran todas las filas que produjo el motor
            {statements.length > 1 ? ': las pestañas afectadas están marcadas con ⚠.' : '.'}
          </p>
        </div>
      )}

      {statements.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
          {statements.map((statement, index) => {
            const mark = OUTCOME_MARKS[statementOutcome(statement)]
            const isActive = index === active
            const tabLabel = `Sentencia ${index + 1} — ${mark.label}${
              statement.truncated ? ' — resultado recortado, hay más filas' : ''
            }`
            return (
              <button
                key={statement.seq}
                ref={(node) => {
                  tabRefs.current[index] = node
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${statement.seq}`}
                aria-controls={`${baseId}-panel-${statement.seq}`}
                aria-selected={isActive}
                aria-label={tabLabel}
                title={tabLabel}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <span aria-hidden className={cn('h-2 w-2 rounded-full', mark.dot)} />#{index + 1}
                {statement.truncated && (
                  // El detalle ya va en el `aria-label` del botón; la marca es solo visual.
                  <span aria-hidden className="text-warning">
                    ⚠
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {activeStatement && (
        <div
          role={statements.length > 1 ? 'tabpanel' : undefined}
          id={statements.length > 1 ? `${baseId}-panel-${activeStatement.seq}` : undefined}
          aria-labelledby={
            statements.length > 1 ? `${baseId}-tab-${activeStatement.seq}` : undefined
          }
        >
          <StatementResultCard statement={activeStatement} database={result.database} />
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-semibold text-foreground">Advertencias</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {result.warnings.map((warning, index) => (
              // El backend no garantiza textos únicos: la posición es la clave estable.
              <li key={index} className="text-sm text-foreground">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** El error de conexión del motor, sin traducir: es el texto que el admin vino a leer. */
function ConnectionError({ error }: { error: QueryErrorOut }) {
  const code = error.code ?? error.sqlstate
  return (
    <>
      {code && <p className="font-mono text-xs text-muted-foreground">Código {code}</p>}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
        {error.message}
      </pre>
    </>
  )
}
