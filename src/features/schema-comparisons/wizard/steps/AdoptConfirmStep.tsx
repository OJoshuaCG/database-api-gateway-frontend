import { Input, Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'
import { hasMysqlProceduralRisk } from '../logic'
import { ACTION_HINTS } from '../messages'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/** Vista 4b (Opción A) — metadata de la versión + modo de creación (solo generar / generar y aplicar). */
export function AdoptConfirmStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const proceduralRisk = hasMysqlProceduralRisk(
    wizard.allItems.data?.items ?? [],
    wizard.selectedItemIds,
    wizard.targetEngine,
  )
  const error = wizard.adopt.error

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Metadata de la versión</h2>
        <p className="text-sm text-muted-foreground">
          Seleccionados: {wizard.selectedItemIds.size} ítem(s) que entrarán a la nueva versión.
        </p>
      </div>

      {proceduralRisk && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          ⚠ Adoptar rutinas/triggers MySQL/MariaDB con cuerpo <code>BEGIN…END</code> puede fallar al
          aplicarse (limitación conocida v1). Considera la Opción B para esos objetos.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre de la versión"
          required
          value={wizard.adoptName}
          onChange={(e) => wizard.setAdoptName(e.target.value)}
          maxLength={200}
        />
        <Textarea
          label="Descripción (opcional)"
          value={wizard.adoptDescription}
          onChange={(e) => wizard.setAdoptDescription(e.target.value)}
          hint="Hoy no se persiste; solo informativo."
          maxLength={1000}
        />
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <label
          className={cn(
            'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
            !wizard.adoptExecuteImmediately ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
          )}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <input
              type="radio"
              name="adopt-mode"
              className="accent-primary"
              checked={!wizard.adoptExecuteImmediately}
              onChange={() => wizard.setAdoptExecuteImmediately(false)}
            />
            Solo generar la versión
          </span>
          <span className="text-xs text-muted-foreground">
            Nace SIN aprobar (<code>reviewed=false</code>). Deberás revisarla y aprobarla antes de
            aplicarla (gate R1).
          </span>
        </label>
        <label
          className={cn(
            'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
            wizard.adoptExecuteImmediately ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
          )}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <input
              type="radio"
              name="adopt-mode"
              className="accent-primary"
              checked={wizard.adoptExecuteImmediately}
              onChange={() => wizard.setAdoptExecuteImmediately(true)}
            />
            Generar y aplicar de inmediato
          </span>
          <span className="text-xs text-muted-foreground">
            Se ejecutará DDL sobre {wizard.targetDetail.data?.name ?? 'el target'} ahora mismo.
            Operación real sobre el motor.
          </span>
        </label>
      </fieldset>

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
          title="No se pudo adoptar la versión"
          onRecalculate={wizard.recalculate}
          onSwitchToExecute={() => wizard.goToStep('executeSelect')}
        />
      )}
    </div>
  )
}
