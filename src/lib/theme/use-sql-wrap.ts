import { useContext } from 'react'
import { SqlWrapContext } from './sql-wrap-context'

export function useSqlWrap() {
  const ctx = useContext(SqlWrapContext)
  if (!ctx) throw new Error('useSqlWrap debe usarse dentro de <SqlWrapProvider>.')
  return ctx
}
