import type { CharsetCollationOptionOut, EngineFamily, EngineType } from '@/lib/contracts'

/**
 * Lógica pura del catálogo global de charset/collation: mapeo motor → familia, formato de
 * etiqueta y agrupación por familia. Sin React ni acceso a red — se testea directamente en
 * `logic.test.ts`.
 */

/**
 * Mapea el motor concreto de un servidor a la familia del catálogo. Este es a propósito el
 * ÚNICO lugar del código que hace esta traducción: MySQL y MariaDB comparten catálogo bajo
 * `engine_family=mysql`; enviarle al backend `engine_family=mariadb` da 422.
 */
export function engineToFamily(engine: EngineType): EngineFamily {
  return engine === 'postgresql' ? 'postgresql' : 'mysql'
}

/**
 * Etiqueta legible de una combinación charset/collation. Vive en un solo lugar porque se usa
 * tanto en el selector de creación de bases como en la pantalla de administración del catálogo.
 */
export function formatOptionLabel(
  option: Pick<CharsetCollationOptionOut, 'charset' | 'collation'>,
): string {
  return option.collation !== null
    ? `${option.charset} · ${option.collation}`
    : `${option.charset} — (collation por defecto del motor)`
}

/** Combinaciones de UNA familia de motor, con los avisos ya calculados para la UI. */
export interface EngineFamilyGroup {
  engineFamily: EngineFamily
  options: CharsetCollationOptionOut[]
  hasEnabled: boolean
  hasDefault: boolean
}

/**
 * Agrupa por `engine_family` preservando el ORDEN en que llegan: el backend ya las devuelve
 * ordenadas por `engine_family`, `charset`, `collation`, así que no se reordena aquí. Calcula
 * `hasEnabled`/`hasDefault` por grupo para que la pantalla de administración muestre los avisos
 * de "esta familia no tiene sugerida" / "no tiene habilitadas" sin recalcularlo ella misma.
 */
export function groupOptionsByFamily(
  options: readonly CharsetCollationOptionOut[],
): EngineFamilyGroup[] {
  const groups: EngineFamilyGroup[] = []
  const byFamily = new Map<EngineFamily, EngineFamilyGroup>()
  for (const option of options) {
    let group = byFamily.get(option.engine_family)
    if (!group) {
      group = { engineFamily: option.engine_family, options: [], hasEnabled: false, hasDefault: false }
      byFamily.set(option.engine_family, group)
      groups.push(group)
    }
    group.options.push(option)
    if (option.enabled) group.hasEnabled = true
    if (option.is_default) group.hasDefault = true
  }
  return groups
}
