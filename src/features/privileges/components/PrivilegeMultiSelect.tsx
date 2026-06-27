import { useMemo } from 'react'
import { MultiCombobox } from '@/components/ui'
import type { EngineType } from '@/lib/contracts'
import { usePrivileges } from '../hooks/use-privileges'

interface PrivilegeMultiSelectProps {
  /** Motor para filtrar el catálogo de privilegios. */
  engine: EngineType | null | undefined
  value: string[]
  onChange: (privileges: string[]) => void
  label?: string
  disabled?: boolean
}

/**
 * Multiselect de privilegios poblado desde el catálogo `/privileges` filtrado por motor
 * (§10). Las opciones se validan contra el catálogo del backend por motor y nivel.
 */
export function PrivilegeMultiSelect({
  engine,
  value,
  onChange,
  label = 'Privilegios',
  disabled,
}: PrivilegeMultiSelectProps) {
  const { data, isLoading } = usePrivileges({ active: true })

  const options = useMemo(() => {
    const names = new Set<string>()
    for (const privilege of data ?? []) {
      if (!engine || privilege.engine === engine) names.add(privilege.name)
    }
    // Conserva los ya seleccionados aunque no estén (o aún no carguen) en el catálogo.
    for (const selected of value) names.add(selected)
    return Array.from(names).sort()
  }, [data, engine, value])

  if (!engine) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground">
          Selecciona un motor para listar los privilegios disponibles.
        </p>
      </div>
    )
  }

  return (
    <MultiCombobox<string>
      items={options}
      selectedItems={value}
      onChange={onChange}
      itemToString={(name) => name}
      itemToKey={(name) => name}
      label={isLoading ? `${label} (cargando…)` : label}
      placeholder="Añadir privilegio…"
      disabled={disabled}
    />
  )
}
