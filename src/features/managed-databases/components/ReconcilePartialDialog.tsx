import { useState } from 'react'
import { Badge, Button, ErrorState, Input, Modal, Spinner, Switch } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { PartialApplicationEntry, ReconcilePartialResult } from '@/lib/contracts'
import { useReconcilePartial, useReconcilePreview } from '../hooks/use-db-migrations'

interface ReconcilePartialDialogProps {
  dbId: number
  databaseName: string
  /** Entrada de `partial_application[]` a reconciliar. Montar solo con objetivo (estado fresco). */
  entry: PartialApplicationEntry
  onClose: () => void
}

/**
 * Flujo de reconciliación de una aplicación parcial (§9) 🔌.
 *
 * Paso 1 (preview): dry-run del plan de reversos. El backend valida `force` ANTES de `dry_run`,
 * así que con sentencias sin reverso el primer dry-run responde 409; `useReconcilePreview`
 * reintenta automáticamente con `force=true` SOLO para mostrar el plan completo y marca
 * `requiresForce` — la decisión de ejecutar con force es del usuario.
 *
 * Paso 2 (ejecutar): doble confirmación tipeando la versión (= `confirm_version`, mismo patrón
 * inline que el rollback) y, si hace falta force, un switch de aceptación explícita.
 */
export function ReconcilePartialDialog({
  dbId,
  databaseName,
  entry,
  onClose,
}: ReconcilePartialDialogProps) {
  const [confirmTyped, setConfirmTyped] = useState('')
  const [forceAck, setForceAck] = useState(false)
  const [executed, setExecuted] = useState<ReconcilePartialResult | null>(null)
  // Tras un 429 (rate limit 10/min) bloqueamos la ejecución unos segundos (patrón del stamp).
  const [cooldown, setCooldown] = useState(false)

  const preview = useReconcilePreview(dbId, entry.version, executed === null)
  const execute = useReconcilePartial(dbId)

  const plan = preview.data?.plan ?? null
  const requiresForce =
    (preview.data?.requiresForce ?? false) || (plan?.unreversible_statements.length ?? 0) > 0
  // Reversos de mayor a menor `seq`: se deshace desde la última sentencia aplicada hacia atrás.
  const statements = plan ? [...plan.statements].sort((a, b) => b.seq - a.seq) : []
  const confirmed = confirmTyped.trim() === entry.version
  const canExecute = confirmed && plan !== null && !cooldown && (!requiresForce || forceAck)

  const runExecute = () => {
    execute.mutate(
      { confirmVersion: entry.version, force: forceAck || undefined },
      {
        onSuccess: (result) => setExecuted(result),
        onError: (err) => {
          if (toApiError(err).status === 429) {
            setCooldown(true)
            window.setTimeout(() => setCooldown(false), 15_000)
          }
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!execute.isPending) onClose()
      }}
      title="Reconciliar aplicación parcial"
      description={`«${databaseName}» · migración ${entry.version}`}
      size="lg"
      footer={
        executed ? (
          <Button onClick={onClose}>Cerrar</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={execute.isPending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={runExecute}
              isLoading={execute.isPending}
              disabled={!canExecute}
            >
              Deshacer {plan?.statements_to_undo ?? entry.statements_to_undo} sentencia(s) 🔌
            </Button>
          </>
        )
      }
    >
      {executed ? (
        <ReconcileResultView result={executed} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            La migración{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{entry.version}</code>{' '}
            aplicó <strong>{entry.applied_statements}</strong> de{' '}
            <strong>{entry.total_statements}</strong> sentencias antes de fallar. La reconciliación
            ejecuta los reversos de las sentencias aplicadas (de la última a la primera) y limpia el
            registro parcial, devolviendo la BD a la versión anterior.
          </p>

          {preview.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Calculando el plan de reversos…
            </div>
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          ) : plan ? (
            <>
              {requiresForce && (
                <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p className="text-foreground">
                    <strong>
                      {plan.unreversible_statements.length} sentencia(s) aplicadas no tienen reverso
                      conocido
                    </strong>
                    : no se pueden deshacer y quedarán aplicadas en el motor. Ejecutar la
                    reconciliación requiere <code>force</code>.
                  </p>
                  {plan.unreversible_statements.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {plan.unreversible_statements.map((sql) => (
                        <li key={sql}>
                          <code className="break-all whitespace-pre-wrap text-muted-foreground">
                            {sql}
                          </code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {plan.unconfirmed_reverses.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p className="text-foreground">
                    Aviso: estos reversos <strong>sí se ejecutan</strong>, pero no son
                    demostrablemente seguros (revísalos antes de continuar):
                  </p>
                  <ul className="flex flex-col gap-1">
                    {plan.unconfirmed_reverses.map((sql) => (
                      <li key={sql}>
                        <code className="break-all whitespace-pre-wrap text-muted-foreground">
                          {sql}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Plan de reversos ({plan.statements_to_undo} sentencia(s), de mayor a menor seq)
                </h3>
                {statements.length > 0 ? (
                  <div className="max-h-64 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="w-12 px-2 py-1.5 font-medium">seq</th>
                          <th className="px-2 py-1.5 font-medium">SQL de reverso</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {statements.map((statement) => (
                          <tr key={statement.seq}>
                            <td className="px-2 py-1.5 align-top text-muted-foreground">
                              {statement.seq}
                            </td>
                            <td className="px-2 py-1.5">
                              <code className="break-all whitespace-pre-wrap">{statement.sql}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    El plan no contiene reversos a ejecutar (todo lo aplicado quedará como está).
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-error/30 p-3">
                <Input
                  label={`Escribe «${entry.version}» para confirmar`}
                  hint="Doble confirmación: la versión de la aplicación parcial (confirm_version)."
                  value={confirmTyped}
                  onChange={(event) => setConfirmTyped(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {requiresForce && (
                  <Switch
                    checked={forceAck}
                    onCheckedChange={setForceAck}
                    label="Ejecutar con force"
                    hint="Acepto que las sentencias sin reverso queden aplicadas en el motor."
                  />
                )}
                {cooldown && (
                  <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-error">
                    Has alcanzado el límite de 10/min. Espera unos segundos e inténtalo de nuevo.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

/** Resultado de la ejecución real: contadores + detalle por sentencia (§9). */
function ReconcileResultView({ result }: { result: ReconcilePartialResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={result.fully_reconciled ? 'success' : result.failed ? 'error' : 'warning'}>
          {result.fully_reconciled
            ? 'reconciliada por completo'
            : result.failed
              ? 'reconciliación con errores'
              : 'reconciliación parcial'}
        </Badge>
        <Badge tone="info">
          deshechas: {result.undone_count ?? 0} de {result.statements_to_undo}
        </Badge>
        {result.remaining_applied_statements != null && (
          <Badge tone={result.remaining_applied_statements > 0 ? 'warning' : 'neutral'}>
            quedan aplicadas: {result.remaining_applied_statements}
          </Badge>
        )}
      </div>

      {result.fully_reconciled ? (
        <p className="rounded-lg border border-success/40 bg-success/5 p-2 text-xs text-foreground">
          La base volvió a la versión anterior sin intervención adicional. Corrige la migración{' '}
          {result.version} en el blueprint y reintenta el apply.
        </p>
      ) : (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
          La reconciliación no fue completa: revisa el estado de la BD y las sentencias restantes
          antes de reintentar el apply.
        </p>
      )}

      {result.unreversible_statements.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
          <p className="text-foreground">Quedaron aplicadas (sin reverso conocido):</p>
          <ul className="flex flex-col gap-1">
            {result.unreversible_statements.map((sql) => (
              <li key={sql}>
                <code className="break-all whitespace-pre-wrap text-muted-foreground">{sql}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.unconfirmed_reverses.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
          <p className="text-foreground">
            Se ejecutaron reversos no demostrablemente seguros (verifica el resultado):
          </p>
          <ul className="flex flex-col gap-1">
            {result.unconfirmed_reverses.map((sql) => (
              <li key={sql}>
                <code className="break-all whitespace-pre-wrap text-muted-foreground">{sql}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.results.length > 0 && (
        <ul className="flex max-h-48 flex-col divide-y divide-border overflow-auto rounded-lg border border-border">
          {result.results.map((item, index) => (
            <li key={item.seq ?? index} className="flex flex-col gap-1 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">seq {item.seq ?? '—'}</span>
                <div className="flex items-center gap-2">
                  {item.execution_ms != null && (
                    <span className="text-muted-foreground">{item.execution_ms} ms</span>
                  )}
                  <Badge tone={item.error ? 'error' : 'success'}>
                    {item.error ? 'error' : (item.status ?? 'ok')}
                  </Badge>
                </div>
              </div>
              {item.sql && (
                <code className="break-all whitespace-pre-wrap text-muted-foreground">
                  {item.sql}
                </code>
              )}
              {item.error && <span className="text-error">{item.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
