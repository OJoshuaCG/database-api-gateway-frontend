import { Badge, CodeBlock } from '@/components/ui'
import {
  type ConnectionMode,
  type QueryPreviewOut,
  type QueryStatementPlanOut,
} from '@/lib/contracts'
import { engineLabel, formatInteger } from '@/lib/utils'
import { dangerCopy, FAIL_CLOSED_EXPLANATION, isFailClosedReason, MODE_OPTIONS } from '../logic'
import { BlockedNotice } from './BlockedNotice'

export interface ClassificationPanelProps {
  preview: QueryPreviewOut
  serverId: number
}

/** Etiqueta del modo tal como se ofreció al elegirlo: el panel no debe estrenar vocabulario. */
function modeLabel(mode: ConnectionMode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode
}

/**
 * Clasificación del lote devuelta por el preview, que es lo último que el admin lee antes de
 * decidir si ejecuta.
 *
 * `blocked` se evalúa PRIMERO y sustituye a todo lo demás: un lote bloqueado vuelve además con
 * `requires_confirmation: true` y sin token, así que mostrar la lista normal insinuaría que hay
 * un camino para ejecutarlo cuando no lo hay.
 */
export function ClassificationPanel({ preview, serverId }: ClassificationPanelProps) {
  const copy = dangerCopy(preview.danger)

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={copy.tone}>{copy.label}</Badge>
          <span className="text-sm text-muted-foreground">
            {preview.statements.length} sentencia(s) · {engineLabel(preview.engine)} · base{' '}
            <code className="font-mono text-foreground">{preview.database}</code>
          </span>
        </div>
        <p className="text-sm text-foreground">{copy.description}</p>
        {/* La identidad efectiva la resuelve el backend, y puede no coincidir con lo elegido
            (un `stored` sin host resuelve a una cuenta concreta): se muestra la suya. */}
        <p className="text-sm text-muted-foreground">
          Se ejecutaría como{' '}
          <strong className="font-semibold text-foreground">{preview.run_as}</strong> (
          {modeLabel(preview.connection_mode)}).
        </p>
      </header>

      {preview.blocked ? (
        <BlockedNotice
          reasons={preview.reasons}
          serverId={serverId}
          statements={preview.statements
            .filter((statement) => statement.danger === 'blocked')
            .map((statement) => ({ seq: statement.seq, sql: statement.sql }))}
        />
      ) : (
        <ol className="flex list-none flex-col gap-3 pl-0">
          {preview.statements.map((statement) => (
            <li key={statement.seq}>
              <StatementPlanCard statement={statement} />
            </li>
          ))}
        </ol>
      )}

      {preview.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            Avisos ({preview.warnings.length})
          </p>
          <ul className="flex list-none flex-col gap-1 pl-0">
            {/* Textos del backend sin retocar: son avisos, no bloqueos, y reescribirlos aquí
                los desincronizaría de lo que dice la API y el historial. */}
            {preview.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`} className="text-sm text-foreground">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Una sentencia del plan: cómo quedó clasificada, a cuánto afectaría y por qué. */
function StatementPlanCard({ statement }: { statement: QueryStatementPlanOut }) {
  const copy = dangerCopy(statement.danger)
  const failClosed = statement.reasons.some((reason) => isFailClosedReason(reason.code))

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{statement.seq + 1}</span>
        <code className="font-mono text-xs text-foreground">{statement.kind}</code>
        <Badge tone={copy.tone}>{copy.label}</Badge>
      </div>

      <CodeBlock code={statement.sql} maxHeightClass="max-h-32" hideLineNumbers />

      {/* La cifra estimada es lo que el admin lee antes de decidir, así que va destacada; su
          ausencia (`null`) significa «no hay cifra exacta», jamás «no afecta a nada», y
          escribir «0 filas» aquí sería la mentira más cara de la pantalla. */}
      {typeof statement.estimated_rows === 'number' ? (
        <p className="text-sm text-foreground">
          Afectaría a{' '}
          <strong className="font-semibold">{formatInteger(statement.estimated_rows)}</strong>{' '}
          fila(s), contadas con la misma credencial que va a ejecutar la sentencia.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No se pudo estimar cuántas filas afectará.</p>
      )}

      {statement.reasons.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-primary">
            Por qué se clasificó así ({statement.reasons.length})
          </summary>
          <ul className="mt-1.5 flex list-none flex-col gap-1 pl-0">
            {statement.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`} className="text-xs text-muted-foreground">
                {reason.message}
              </li>
            ))}
          </ul>
          {/* El caso más frecuente con SQL legítimo (un `CALL`, por ejemplo): se clasificó
              arriba por no poder analizarlo, no porque se sepa que destruye datos. */}
          {failClosed && (
            <p className="mt-1.5 text-xs text-muted-foreground">{FAIL_CLOSED_EXPLANATION}</p>
          )}
        </details>
      )}
    </article>
  )
}
