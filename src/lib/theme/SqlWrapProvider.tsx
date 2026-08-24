import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_SQL_WRAP,
  isSqlWrapDisabled,
  SqlWrapContext,
  SQL_WRAP_STORAGE_KEY,
} from './sql-wrap-context'

function readInitialSqlWrap(): boolean {
  try {
    const stored = localStorage.getItem(SQL_WRAP_STORAGE_KEY)
    if (stored !== null) return !isSqlWrapDisabled(stored)
  } catch {
    /* almacenamiento no disponible: se usa el modo por omisión. */
  }
  return DEFAULT_SQL_WRAP
}

/**
 * Ajuste de línea de los visores de SQL, persistido como preferencia del usuario.
 *
 * Solo escribe `data-sql-wrap` en `<html>`: el cambio de modo lo hace el CSS (`styles/code.css`),
 * que conmuta el `white-space` de las líneas. Por eso alternar entre ajuste y scroll no
 * re-renderiza ningún bloque de código —misma mecánica que la paleta de sintaxis— y todos los
 * bloques de la app cambian a la vez, sin que ninguno se quede desincronizado con el visor a
 * pantalla completa.
 *
 * La preferencia es global a propósito: un bloque con ajuste al lado de otro sin él haría que dos
 * SQL contiguos se leyeran con reglas distintas.
 */
export function SqlWrapProvider({ children }: { children: ReactNode }) {
  const [wrap, setWrap] = useState<boolean>(readInitialSqlWrap)

  useEffect(() => {
    document.documentElement.dataset.sqlWrap = wrap ? 'on' : 'off'
    try {
      localStorage.setItem(SQL_WRAP_STORAGE_KEY, wrap ? 'on' : 'off')
    } catch {
      /* almacenamiento no disponible: el modo sigue funcionando en memoria. */
    }
  }, [wrap])

  const toggleWrap = useCallback(() => setWrap((value) => !value), [])

  return <SqlWrapContext.Provider value={{ wrap, toggleWrap }}>{children}</SqlWrapContext.Provider>
}
