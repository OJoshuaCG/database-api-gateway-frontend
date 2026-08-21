import { createContext } from 'react'

/**
 * Ajuste de línea en los visores de SQL. El valor vive en `<html data-sql-wrap>` y lo aplica el
 * CSS (`styles/code.css`); aquí solo está el estado que ve el usuario, igual que con la paleta.
 */
export interface SqlWrapContextValue {
  /** `true` = las líneas largas se envuelven; `false` = se leen con scroll horizontal. */
  wrap: boolean
  toggleWrap: () => void
}

export const SqlWrapContext = createContext<SqlWrapContextValue | null>(null)

export const SQL_WRAP_STORAGE_KEY = 'gw-sql-wrap'

/**
 * Se envuelve por omisión: es lo que evita que haya que arrastrar en horizontal para leer una
 * sentencia completa. Es seguro para DDL porque el modo ajuste conserva la numeración por línea
 * lógica y sangra las continuaciones, así que sigue siendo inequívoco dónde empieza cada línea.
 */
export const DEFAULT_SQL_WRAP = true

/** Solo `'off'` desactiva el ajuste: cualquier otro valor almacenado cae en el por omisión. */
export function isSqlWrapDisabled(value: string | null | undefined): boolean {
  return value === 'off'
}
