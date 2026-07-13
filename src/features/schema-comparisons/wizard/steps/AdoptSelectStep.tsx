import { ItemSelectionPanel } from '../ItemSelectionPanel'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

/** Vista 4a (Opción A) — selección granular de ítems que entrarán a la nueva versión del blueprint. */
export function AdoptSelectStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          Adoptar diff como versión del blueprint #{wizard.targetDetail.data?.model_id}
        </h2>
        <p className="text-sm text-muted-foreground">
          Se creará una versión nueva del blueprint del target; no se toca ninguna otra base de
          datos.
        </p>
      </div>

      <ItemSelectionPanel
        itemsQuery={wizard.allItems}
        selectedItemIds={wizard.selectedItemIds}
        reviewedItemIds={wizard.reviewedItemIds}
        onToggle={wizard.toggleItemSelection}
        onMarkReviewed={wizard.markReviewed}
        onApplyShortcut={wizard.applyShortcut}
        targetEngine={wizard.targetEngine}
        supportsBulkModes={false}
      />
    </div>
  )
}
