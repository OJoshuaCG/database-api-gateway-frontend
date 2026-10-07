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
  /**
   * `true` = quien opera NO puede otorgar privilegios sensibles (`engine_users.grant_admin`): se
   * ocultan de las opciones los que el catálogo marca `is_sensitive` (los ya elegidos se
   * conservan, para poder quitarlos) y `blockedHint` se muestra como motivo. Es una pista de UI: el
   * servidor responde 403 `engine_user.grant_admin_required` igual.
   */
  sensitiveBlocked?: boolean
  /** Motivo VISIBLE de `sensitiveBlocked`; se muestra solo mientras esté bloqueado. */
  blockedHint?: string
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
  sensitiveBlocked = false,
  blockedHint,
}: PrivilegeMultiSelectProps) {
  const { data, isLoading } = usePrivileges({ active: true })

  const options = useMemo(() => {
    const names = new Set<string>()
    for (const privilege of data ?? []) {
      if (engine && privilege.engine !== engine) continue
      if (sensitiveBlocked && privilege.is_sensitive) continue
      names.add(privilege.name)
    }
    // Conserva los ya seleccionados aunque no estén (o aún no carguen) en el catálogo.
    for (const selected of value) names.add(selected)
    return Array.from(names).sort()
  }, [data, engine, value, sensitiveBlocked])

  if (!engine) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground">
          Seleccioná un motor para listar los privilegios disponibles.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
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
      {sensitiveBlocked && blockedHint && (
        <p className="text-xs text-muted-foreground">{blockedHint}</p>
      )}
    </div>
  )
}
