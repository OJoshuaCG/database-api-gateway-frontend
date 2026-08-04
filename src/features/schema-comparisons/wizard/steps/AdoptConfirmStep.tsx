import { Input, RadioCardGroup, Textarea, type RadioCardOption } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { hasMysqlProceduralRisk } from '../logic'
import { ACTION_HINTS } from '../messages'
import { DependencyClosureNotice } from '../DependencyClosureNotice'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/** El wizard guarda un boolean; el grupo de radios necesita un `value` string (acaba en el DOM). */
type AdoptMode = 'only_generate' | 'apply_now'

/** Vista 4b (Opción A) — cierre de dependencias de la selección + metadata de la versión + modo
 * de creación (solo generar / generar y aplicar). */
export function AdoptConfirmStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const proceduralRisk = hasMysqlProceduralRisk(
    wizard.allItems.data?.items ?? [],
    wizard.selectedItemIds,
    wizard.targetEngine,
  )
  const error = wizard.adopt.error

  // Dentro del componente: el hint del segundo modo interpola el nombre del target.
  const adoptModeOptions: readonly RadioCardOption<AdoptMode>[] = [
    {
      value: 'only_generate',
      label: 'Solo generar la versión',
      hint: (
        <>
          Nace SIN aprobar (<code>reviewed=false</code>). Deberás revisarla y aprobarla antes de
          aplicarla (gate R1).
        </>
      ),
    },
    {
      value: 'apply_now',
      label: 'Generar y aplicar de inmediato',
      hint: `Se ejecutará DDL sobre ${wizard.targetDetail.data?.name ?? 'el target'} ahora mismo. Operación real sobre el motor.`,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Metadata de la versión</h2>
        <p className="text-sm text-muted-foreground">
          Seleccionados: {wizard.selectedItemIds.size} ítem(s) que entrarán a la nueva versión.
        </p>
      </div>

      <DependencyClosureNotice
        resolve={wizard.resolveSelection}
        items={wizard.allItems.data?.items ?? []}
      />

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

      <RadioCardGroup<AdoptMode>
        title="Qué hacer con la versión"
        description="Elige una: solo crear la versión, o crearla y aplicarla al target en el mismo paso."
        options={adoptModeOptions}
        value={wizard.adoptExecuteImmediately ? 'apply_now' : 'only_generate'}
        onChange={(mode) => wizard.setAdoptExecuteImmediately(mode === 'apply_now')}
      />

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
          onResolveDependencies={() =>
            wizard.applySuggestedItemIds(toApiError(error).suggestedItemIds ?? [])
          }
        />
      )}
    </div>
  )
}
