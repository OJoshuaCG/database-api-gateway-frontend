import { MultiCombobox } from '@/components/ui'
import { useDatabaseModels } from '@/features/database-models/hooks/use-database-models'
import { PAGINATION, type DatabaseModelOut } from '@/lib/contracts'

interface BlueprintAllowlistPickerProps {
  /** Ids de los blueprints permitidos. */
  value: number[]
  onChange: (next: number[]) => void
  /** `true` cuando la selección incluye un scope destructivo: el servidor exige al menos uno. */
  required: boolean
}

/**
 * Blueprints sobre los que el token puede operar. Vacío significa «sin restricción de blueprint»
 * salvo con un scope destructivo, donde la lista es obligatoria: revertir o marcar versiones sin
 * acotar a qué blueprint es lo que el servidor rechaza con 422 `blueprint_allowlist_required`.
 */
export function BlueprintAllowlistPicker({
  value,
  onChange,
  required,
}: BlueprintAllowlistPickerProps) {
  const blueprints = useDatabaseModels({ page: 1, size: PAGINATION.maxSize })
  const availableBlueprints = blueprints.data?.items ?? []
  const selectedBlueprints = availableBlueprints.filter((blueprint) => value.includes(blueprint.id))

  return (
    <div className="flex flex-col gap-1">
      <MultiCombobox<DatabaseModelOut>
        items={availableBlueprints}
        selectedItems={selectedBlueprints}
        onChange={(next) => onChange(next.map((blueprint) => blueprint.id))}
        itemToString={(blueprint) => blueprint.name}
        itemToKey={(blueprint) => blueprint.id}
        label="Blueprints permitidos"
        placeholder={blueprints.isPending ? 'Cargando blueprints…' : 'Añadir blueprint…'}
      />
      <p className="text-xs text-muted-foreground">
        {required
          ? 'Obligatorio con permisos destructivos: elegí al menos un blueprint.'
          : 'Opcional: vacío significa sin restricción de blueprint.'}
      </p>
    </div>
  )
}
