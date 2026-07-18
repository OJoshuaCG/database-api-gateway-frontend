import { Badge, Input, Spinner, Switch } from '@/components/ui'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import { CLONE_ACTION_HINTS } from '../messages'
import type { DatabaseCloneWizard } from '../use-database-clone-wizard'

/**
 * Vista 4 — preview autoritativo del plan resuelto (limpieza + estructura + datos + omitidos) y
 * doble confirmación: reescribir el nombre exacto del destino + el `confirm_token` de `preview`.
 */
export function PreviewStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { preview, job } = wizard
  const targetName = job.data?.target_database_name ?? ''
  const isQuarantined = wizard.targetManagedDetail.data?.status === 'error'
  const error = wizard.execute.error

  if (preview.isLoading && !preview.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Resolviendo el plan…
      </div>
    )
  }
  if (preview.isError && !preview.data) {
    return (
      <ErrorRecoveryPanel
        error={preview.error}
        title="No se pudo previsualizar el plan"
        onReplan={wizard.replan}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Confirmar clonación</h2>
        <p className="text-sm text-muted-foreground">
          Revisa exactamente qué se hará antes de encolar la clonación.
        </p>
      </div>

      {preview.data && (
        <>
          {preview.data.clean_statements.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-foreground">
                🔴 Limpieza del destino ({preview.data.clean_statements.length})
              </p>
              <div className="flex flex-col gap-1 rounded-lg border border-error/30 bg-error/5 p-3">
                {preview.data.clean_statements.map((statement, index) => (
                  <code key={index} className="overflow-x-auto whitespace-pre text-xs text-foreground">
                    {statement.sql}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">
              Estructura ({preview.data.structure_statements.length} sentencia(s))
            </p>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface-muted p-3">
              {preview.data.structure_statements.map((statement, index) => (
                <code key={index} className="overflow-x-auto whitespace-pre text-xs text-foreground">
                  {statement.sql}
                </code>
              ))}
              {preview.data.structure_statements.length === 0 && (
                <p className="text-xs text-muted-foreground">Sin sentencias de estructura.</p>
              )}
            </div>
          </div>

          {preview.data.data_tables.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-foreground">
                Datos ({preview.data.data_tables.length} tabla(s))
              </p>
              <div className="flex flex-col gap-1">
                {preview.data.data_tables.map((table) => (
                  <div
                    key={table.table}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="text-foreground">{table.table}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {table.row_estimate != null && <span>~{table.row_estimate} filas</span>}
                      <Badge tone={table.upsert ? 'warning' : 'neutral'}>
                        {table.upsert ? 'upsert' : 'insert'}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.data.skipped.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm font-semibold text-foreground">
                {preview.data.skipped.length} objeto(s) NO se clonarán (no portables)
              </p>
              {preview.data.skipped.map((object) => (
                <p key={`${object.object_type}:${object.name}`} className="text-xs text-muted-foreground">
                  <strong>{object.name}</strong> ({object.object_type}) — {object.portability_reason}
                </p>
              ))}
            </div>
          )}

          {preview.data.will_adopt && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
              ℹ Al terminar se adoptará el destino y se stampará el blueprint del origen.
            </p>
          )}

          {preview.data.warnings.map((warning, index) => (
            <p key={index} className="rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
        </>
      )}

      <Input
        label={`Escribe «${targetName}» para confirmar`}
        value={wizard.confirmTargetName}
        onChange={(e) => wizard.setConfirmTargetName(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        error={
          wizard.confirmTargetName.length > 0 && wizard.confirmTargetName !== targetName
            ? 'No coincide con el nombre real del destino.'
            : undefined
        }
      />

      <div className="flex items-center gap-2 text-sm">
        {preview.data ? (
          <span className="text-success">✓ Vista previa lista</span>
        ) : preview.isFetching ? (
          <span className="text-muted-foreground">⏳ Obteniendo token de confirmación…</span>
        ) : (
          <span className="text-error">✗ No se pudo obtener el token de confirmación</span>
        )}
      </div>

      {isQuarantined && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3">
          <p className="text-sm font-semibold text-foreground">Destino en cuarentena</p>
          <p className="text-xs text-muted-foreground">
            El destino está en cuarentena (<code>status=error</code>). Solo si ya lo inspeccionaste,
            fuerza la ejecución pese a la cuarentena.
          </p>
          <Switch
            checked={wizard.force}
            onCheckedChange={wizard.setForce}
            label="Forzar ejecución pese a la cuarentena"
            hint="Override de cuarentena (force=true)."
          />
        </div>
      )}

      {wizard.actionCooldown && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {CLONE_ACTION_HINTS.rateLimited}
        </p>
      )}

      {Boolean(error) && (
        <ErrorRecoveryPanel
          error={error}
          title="No se pudo ejecutar la clonación"
          onReplan={wizard.replan}
          onForceQuarantine={() => wizard.setForce(true)}
          onRecomputeToken={() => void preview.refetch()}
        />
      )}
    </div>
  )
}
