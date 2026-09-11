import { CopyIcon, IconButton, Input, RadioCardGroup, Textarea, type RadioCardOption } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { isClipboardAvailable } from '@/lib/utils'
import { useToast } from '@/lib/toast/use-toast'
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
  const toast = useToast()
  const proceduralRisk = hasMysqlProceduralRisk(
    wizard.allItems.data?.items ?? [],
    wizard.selectedItemIds,
    wizard.targetEngine,
  )
  const error = wizard.adopt.error

  // SIEMPRE `targetName` (= `target_database_name` de la comparación), NUNCA `targetDetail.name`:
  // es contra ese campo que el backend compara `confirm_target_name`, carácter por carácter.
  // `targetDetail` es la ficha del inventario y podría no estar cargada o no ser el mismo string.
  const targetName = wizard.targetName ?? ''
  const typed = wizard.adoptConfirmTargetName
  const nameMatches = typed.length > 0 && typed === targetName

  const handleCopyTargetName = async () => {
    if (!isClipboardAvailable()) {
      toast.error('El portapapeles no está disponible', 'Escribe el nombre a mano.')
      return
    }
    try {
      await navigator.clipboard.writeText(targetName)
      toast.success('Nombre copiado al portapapeles')
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

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
      hint: `Se ejecutará DDL sobre ${targetName || 'el target'} ahora mismo. Operación real sobre el motor, e irreversible.`,
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

      {/*
        La confirmación aparece SOLO con «generar y aplicar» encendido. Con el toggle apagado el
        backend ignora `confirm_target_name`, porque crear la versión no toca ningún motor: pedir
        confirmación ahí sería fricción sobre el caso inofensivo, que es exactamente cómo se
        entrena el reflejo de confirmar sin leer.
      */}
      {wizard.adoptExecuteImmediately && (
        <div className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error/5 p-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">
              Confirmar la aplicación sobre el target 🔌
            </p>
            <p className="text-xs text-muted-foreground">
              Se va a ejecutar DDL sobre una base de datos real y no hay vuelta atrás. Escribe el
              nombre exacto del target para habilitar el botón — mismo patrón que un DROP DATABASE.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <code className="flex-1 select-all break-all font-mono text-sm text-foreground">
              {targetName}
            </code>
            <IconButton
              type="button"
              label="Copiar el nombre del target"
              icon={<CopyIcon />}
              variant="outline"
              size="icon-sm"
              onClick={() => void handleCopyTargetName()}
            />
          </div>

          <Input
            label={`Escribe «${targetName}» para confirmar`}
            className="font-mono"
            value={typed}
            onChange={(e) => wizard.setAdoptConfirmTargetName(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            hint="Debe coincidir exactamente, incluidas mayúsculas y minúsculas."
            error={typed.length > 0 && !nameMatches ? 'No coincide con el nombre real del target.' : undefined}
          />

          {typed.length > 0 && (
            <p className={nameMatches ? 'text-xs text-success' : 'text-xs text-error'}>
              {nameMatches ? '✓ Coincide' : '✗ No coincide'}
            </p>
          )}
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
