import type { ExecuteMode } from '@/lib/contracts'
import { ErrorState, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ItemSelectionPanel } from '../ItemSelectionPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

const MODE_OPTIONS: { value: ExecuteMode; label: string; hint: string }[] = [
  {
    value: 'all',
    label: 'Ejecutar todo',
    hint:
      'Incluye TODO, también lo destructivo. NO incluye objetos procedurales (rutinas/triggers/' +
      'eventos): esos requieren selección manual.',
  },
  {
    value: 'all_except_destructive',
    label: 'Ejecutar todo excepto destructivo',
    hint:
      'Excluye DROP y todo lo potencialmente destructivo (achicar tipos, quitar valores de ENUM, ' +
      'cambios de collation/charset, renames sospechados…), además de los procedurales.',
  },
  {
    value: 'custom',
    label: 'Personalizado',
    hint:
      'Selección granular. Los objetos con 🟣 requieren revisión individual SOLO se ejecutan aquí, ' +
      'y hay que ver su cuerpo completo antes de marcarlos.',
  },
]

/** Vista 5a (Opción B) — modo de ejecución + selección granular (solo en `custom`) + vista previa. */
export function ExecuteSelectStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const targetName = wizard.targetDetail.data?.name ?? wizard.targetDb?.name ?? 'el target'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          Ejecutar diff sobre {targetName} (sin blueprint)
        </h2>
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-foreground">
          ⚠ Operación REAL sobre el motor. Modifica {targetName} directamente.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        {MODE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
              wizard.executeMode === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="radio"
                name="execute-mode"
                className="accent-primary"
                checked={wizard.executeMode === option.value}
                onChange={() => wizard.setExecuteMode(option.value)}
              />
              {option.label}
            </span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </label>
        ))}
      </fieldset>

      {wizard.executeMode === 'custom' && (
        <ItemSelectionPanel
          itemsQuery={wizard.allItems}
          selectedItemIds={wizard.selectedItemIds}
          reviewedItemIds={wizard.reviewedItemIds}
          onToggle={wizard.toggleItemSelection}
          onMarkReviewed={wizard.markReviewed}
          onApplyShortcut={wizard.applyShortcut}
          targetEngine={wizard.targetEngine}
        />
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <p className="text-sm font-medium text-foreground">Vista previa del conjunto a ejecutar</p>
        {wizard.preview.isLoading && !wizard.preview.data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Calculando…
          </div>
        ) : wizard.preview.isError && !wizard.preview.data ? (
          <ErrorState
            error={wizard.preview.error}
            onRetry={() => void wizard.preview.refetch()}
            title="No se pudo previsualizar la ejecución"
          />
        ) : wizard.preview.data ? (
          <p className="text-sm text-foreground">
            Se ejecutarán <strong>{wizard.preview.data.statements.length}</strong> sentencia(s) con
            el modo actual (previsualización autoritativa del servidor).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Elige un modo (y al menos un ítem, en personalizado) para ver la vista previa.
          </p>
        )}
      </div>
    </div>
  )
}
