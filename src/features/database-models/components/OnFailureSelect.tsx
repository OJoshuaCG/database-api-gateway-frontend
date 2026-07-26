import { Combobox } from '@/components/ui'
import type { OnFailureMode } from '@/lib/contracts'

interface OnFailureOption {
  value: OnFailureMode
  label: string
  description: string
}

/**
 * Modos de `on_failure` (§9): qué hacer si una migración multi-sentencia falla a mitad.
 * Solo relevante en MySQL/MariaDB (sin DDL transaccional); en PostgreSQL se ignora.
 */
const ON_FAILURE_OPTIONS: OnFailureOption[] = [
  {
    value: 'auto',
    label: 'auto — deshacer si es seguro',
    description:
      'Si falla a mitad, deshace las sentencias aplicadas solo cuando todos los reversos son seguros; si no, deja el avance registrado (checkpoint) para retomar o reconciliar.',
  },
  {
    value: 'reconcile',
    label: 'reconcile — deshacer siempre',
    description:
      'Si falla a mitad, intenta deshacer todas las sentencias aplicadas, incluso con reversos no demostrablemente seguros.',
  },
  {
    value: 'leave',
    label: 'leave — dejar el avance',
    description:
      'No deshace nada: el avance parcial queda registrado (checkpoint) para retomar el apply desde ahí o reconciliar después.',
  },
]

interface OnFailureSelectProps {
  value: OnFailureMode
  onChange: (mode: OnFailureMode) => void
  disabled?: boolean
  hint?: string
}

/**
 * Selector discreto del modo `on_failure` para `apply` (§9) y `apply-all` (§8).
 * Default `auto` (el del backend); muestra una descripción corta del modo elegido.
 */
export function OnFailureSelect({
  value,
  onChange,
  disabled,
  hint = 'Solo relevante en MySQL/MariaDB.',
}: OnFailureSelectProps) {
  const selected = ON_FAILURE_OPTIONS.find((option) => option.value === value) ?? null

  return (
    <div className="flex flex-col gap-1">
      <Combobox<OnFailureOption>
        items={ON_FAILURE_OPTIONS}
        value={selected}
        onChange={(option) => onChange(option?.value ?? 'auto')}
        itemToString={(option) => option.label}
        itemToKey={(option) => option.value}
        label="Si falla a mitad (on_failure)"
        hint={hint}
        disabled={disabled}
      />
      {selected && <p className="text-xs text-muted-foreground">{selected.description}</p>}
    </div>
  )
}
