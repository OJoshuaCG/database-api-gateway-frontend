import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Combobox } from '@/components/ui/Combobox'
import { queryKeys } from '@/lib/api/query-keys'
import type { CharsetCollationOptionOut, EngineFamily } from '@/lib/contracts'
import { formatOptionLabel } from '../logic'
import { listCharsetCollationOptions } from '../api/charset-collation-options.api'

/**
 * Selector cerrado de charset/collation, reemplazo de los inputs de texto libre en los
 * formularios de creación de bases de datos. Contrato de props DEFINITIVO: dos formularios
 * consumidores (creación de BD a nivel servidor y creación de BD gestionada) lo integran en
 * paralelo — no cambiar las formas de aquí sin coordinar con ellos.
 */

/** Combinación concreta elegida: charset + collation (`null` = collation por defecto del motor). */
export interface CharsetCollationValue {
  charset: string
  collation: string | null
}

/**
 * Combinación repoblada desde `ApiError.charsetRejected.allowed` (422 de catálogo, §8.3 de la
 * API). Ya viene camelCase porque `src/lib/api/errors.ts` la normaliza así; por eso NO comparte
 * forma exacta con `CharsetCollationOptionOut` (que es snake_case y sí trae `id`).
 */
export interface CharsetCollationOverrideOption {
  charset: string
  collation: string | null
  isDefault: boolean
}

export interface CharsetCollationSelectorProps {
  /** `null` = todavía no se eligió servidor/motor: el selector queda deshabilitado. */
  engineFamily: EngineFamily | null
  /**
   * `undefined` = "sin decidir todavía": el selector se autopreselecciona apenas tenga datos
   * (la fila `is_default` si existe, o si no hay ninguna, queda en `null`) y avisa con `onChange`
   * UNA vez. `null` = elección EXPLÍCITA "usar el valor por defecto del motor" (no se envía nada).
   * `CharsetCollationValue` = una combinación concreta del catálogo.
   */
  value: CharsetCollationValue | null | undefined
  onChange: (value: CharsetCollationValue | null) => void
  /**
   * Repuebla el selector con `public_context.allowed` de un 422 de catálogo, SIN pedir de nuevo
   * al backend (§8.3 del doc de la API). Mientras esté presente, tiene prioridad sobre la
   * consulta normal.
   */
  overrideOptions?: CharsetCollationOverrideOption[]
  disabled?: boolean
  error?: string
  label?: string
  hint?: string
}

type SelectorOption = CharsetCollationOptionOut | CharsetCollationOverrideOption

type SelectorItem = { kind: 'engine-default' } | { kind: 'option'; option: SelectorOption }

const ENGINE_DEFAULT_ITEM: SelectorItem = { kind: 'engine-default' }
const ENGINE_DEFAULT_LABEL = 'Usar el valor por defecto del motor'
const DEFAULT_LABEL = 'Charset y collation'
const EMPTY_HINT =
  'No hay combinaciones habilitadas para este motor. La base se creará con el valor por defecto del servidor.'
const OVERRIDE_HINT = 'Lista actualizada con las combinaciones disponibles.'
const NO_ENGINE_HINT = 'Elegí primero un servidor.'

/** `is_default` (contrato Zod) vs. `isDefault` (contexto de error ya camelCase): unifica ambos. */
function isOptionDefault(option: SelectorOption): boolean {
  return 'is_default' in option ? option.is_default : option.isDefault
}

function sameCombination(value: CharsetCollationValue, option: SelectorOption): boolean {
  return value.charset === option.charset && value.collation === option.collation
}

/**
 * `useCharsetCollationOptions` (contexto ya construido, no se toca) no admite pasar opciones de
 * TanStack Query por-llamada — no acepta un `enabled`. Este selector reimplementa la MISMA
 * queryKey/queryFn pero deshabilitable: imprescindible para NO pedir de nuevo al backend cuando
 * llega `overrideOptions` (§8.3 de la API, requisito duro, no una preferencia) y para evitar la
 * petición mientras no hay motor elegido. Comparte caché con el resto de la app porque usa la
 * misma fábrica de query keys y la misma función de la capa API.
 */
function useCatalogOptions(engineFamily: EngineFamily | null, enabled: boolean) {
  const params = { engine_family: engineFamily ?? undefined, only_enabled: true }
  return useQuery({
    queryKey: queryKeys.charsetCollationOptions.list(params),
    queryFn: ({ signal }) => listCharsetCollationOptions(params, signal),
    enabled,
  })
}

export function CharsetCollationSelector({
  engineFamily,
  value,
  onChange,
  overrideOptions,
  disabled,
  error,
  label = DEFAULT_LABEL,
  hint,
}: CharsetCollationSelectorProps) {
  const usingOverride = overrideOptions !== undefined
  const query = useCatalogOptions(engineFamily, !usingOverride && engineFamily !== null)

  const isLoading = !usingOverride && engineFamily !== null && query.isLoading
  const currentOptions: SelectorOption[] = usingOverride
    ? overrideOptions
    : engineFamily === null
      ? []
      : (query.data ?? [])

  const items: SelectorItem[] = [
    ENGINE_DEFAULT_ITEM,
    ...currentOptions.map((option): SelectorItem => ({ kind: 'option', option })),
  ]

  // Patrón "ajustar estado durante el render" (no `useEffect`: `react-hooks/set-state-in-effect`
  // es error en este repo). Autopreselecciona UNA vez por familia cuando el consumidor todavía no
  // decidió (`value === undefined`) y ya hay datos para decidir con qué. Si `engineFamily` cambia
  // de nuevo más adelante, este selector NO limpia el `value` anterior del padre por su cuenta:
  // descartar la selección al cambiar de familia es responsabilidad del formulario consumidor.
  const [appliedForFamily, setAppliedForFamily] = useState<EngineFamily | null>(null)
  const dataReady = usingOverride || query.data !== undefined
  if (
    value === undefined &&
    engineFamily !== null &&
    engineFamily !== appliedForFamily &&
    dataReady
  ) {
    setAppliedForFamily(engineFamily)
    const defaultOption = currentOptions.find(isOptionDefault)
    onChange(
      defaultOption ? { charset: defaultOption.charset, collation: defaultOption.collation } : null,
    )
  }

  let selectedItem: SelectorItem | null
  if (value === undefined) {
    selectedItem = null
  } else if (value === null) {
    selectedItem = ENGINE_DEFAULT_ITEM
  } else {
    const found = items.find(
      (item) => item.kind === 'option' && sameCombination(value, item.option),
    )
    selectedItem = found ?? null
  }

  function itemToKey(item: SelectorItem): string {
    return item.kind === 'engine-default'
      ? 'engine-default'
      : `${item.option.charset}::${item.option.collation ?? ''}`
  }

  function itemToString(item: SelectorItem): string {
    if (item.kind === 'engine-default') return ENGINE_DEFAULT_LABEL
    const base = formatOptionLabel(item.option)
    return isOptionDefault(item.option) ? `${base} ⭐ sugerida` : base
  }

  function handleChange(item: SelectorItem | null) {
    if (item === null || item.kind === 'engine-default') {
      onChange(null)
      return
    }
    onChange({ charset: item.option.charset, collation: item.option.collation })
  }

  // Prioridad: el hint externo del formulario siempre gana cuando viene; los textos fijos de
  // abajo son solo el respaldo que describe el estado propio del selector.
  let resolvedHint = hint
  if (engineFamily === null) {
    resolvedHint = hint ?? NO_ENGINE_HINT
  } else if (usingOverride) {
    resolvedHint = hint ?? OVERRIDE_HINT
  } else if (!isLoading && !query.isError && currentOptions.length === 0) {
    resolvedHint = hint ?? EMPTY_HINT
  }

  return (
    <Combobox<SelectorItem>
      items={items}
      value={selectedItem}
      onChange={handleChange}
      itemToString={itemToString}
      itemToKey={itemToKey}
      label={label}
      hint={resolvedHint}
      error={error}
      disabled={disabled || engineFamily === null || isLoading}
      isLoading={isLoading}
      clearable={false}
    />
  )
}
