import { Input, Switch } from '@/components/ui'
import { ACTION_HINTS } from '../messages'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/**
 * Vista 5b (Opción B) — doble confirmación: reescribir el nombre exacto del target (mismo patrón
 * que `ConfirmDialog`'s `confirmWord`, pero inline por ser un paso de página) + el `confirm_token`
 * autoritativo de `execute-preview`, más el override de cuarentena si aplica.
 */
export function ExecuteConfirmStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  // SIEMPRE desde la respuesta de la comparación: `targetDetail` no existe para una BD cruda sin
  // registrar (no hay nada que consultar), pero `target_database_name` sí está garantizado.
  const targetName = wizard.targetName ?? ''
  const isQuarantined = wizard.targetDetail.data?.status === 'error'
  const error = wizard.execute.error

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Confirmar ejecución</h2>
        <p className="text-sm text-muted-foreground">
          Escribe el nombre exacto de <strong>{targetName}</strong> para confirmar — mismo patrón
          que un DROP DATABASE.
        </p>
      </div>

      <Input
        label={`Escribe «${targetName}» para confirmar`}
        value={wizard.confirmTargetName}
        onChange={(e) => wizard.setConfirmTargetName(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        error={
          wizard.confirmTargetName.length > 0 && wizard.confirmTargetName !== targetName
            ? 'No coincide con el nombre real del target.'
            : undefined
        }
      />

      <div className="flex items-center gap-2 text-sm">
        {wizard.preview.data ? (
          <span className="text-success">
            ✓ Vista previa lista ({wizard.preview.data.statements.length} sentencia(s))
          </span>
        ) : wizard.preview.isFetching ? (
          <span className="text-muted-foreground">⏳ Obteniendo token de confirmación…</span>
        ) : (
          <span className="text-error">
            ✗ Vuelve al paso anterior y ajusta el modo/selección para obtener el token
          </span>
        )}
      </div>

      {isQuarantined && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3">
          <p className="text-sm font-semibold text-foreground">Target en cuarentena</p>
          <p className="text-xs text-muted-foreground">
            El target está en cuarentena (<code>status=error</code>). Solo si ya lo inspeccionaste,
            fuerza la ejecución pese a la cuarentena.
          </p>
          <Switch
            checked={wizard.force}
            onCheckedChange={wizard.setForce}
            label="Forzar ejecución pese a la cuarentena"
            hint="Override de cuarentena (?force=true)."
          />
        </div>
      )}

      {wizard.pendingReviewIds.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          {wizard.pendingReviewIds.length} ítem(s) seleccionado(s) requieren revisión individual:
          vuelve al paso anterior y abre su SQL completo antes de continuar.
        </p>
      )}

      {wizard.actionCooldown && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {ACTION_HINTS.rateLimited}
        </p>
      )}

      {Boolean(error) && (
        <ErrorRecoveryPanel
          error={error}
          title="No se pudo ejecutar el diff"
          onRecalculate={wizard.recalculate}
          onSwitchToAdopt={() => wizard.goToStep('adoptSelect')}
          onForceQuarantine={() => wizard.setForce(true)}
          onRecomputeToken={() => void wizard.preview.refetch()}
        />
      )}
    </div>
  )
}
