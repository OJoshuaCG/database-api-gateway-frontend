import { Navigate, useSearchParams } from 'react-router-dom'

/**
 * `/database-clones/lotes` dejó de ser el asistente: ahora los lotes viven en el historial y
 * cada uno tiene su dirección. Esta ruta solo traduce los enlaces viejos, que son los únicos
 * que alguien pudo haberse guardado.
 */
export function CloneBatchLegacyRedirect() {
  const [params] = useSearchParams()
  const batchId = params.get('batchId')
  if (batchId && /^\d+$/.test(batchId)) {
    return <Navigate to={`/database-clones/lotes/${batchId}`} replace />
  }
  return <Navigate to="/database-clones?tab=lotes" replace />
}
