import { useParams } from 'react-router-dom'
import { ErrorState } from '@/components/ui'
import { ManagedDatabaseMigrationsContent } from '../components/ManagedDatabaseMigrationsContent'

/**
 * Wrapper delgado de la ruta `/managed-databases/:databaseId/migrations`: solo valida el `id` de
 * la URL y delega todo lo demás a `ManagedDatabaseMigrationsContent`, que también se monta como
 * pestaña `migrations` de la ficha unificada (`ServerDatabaseDetailPage`) cuando la base ya está
 * adoptada. Se conserva esta ruta por compatibilidad con enlaces guardados; el destino recomendado
 * para llegar acá es la ficha completa (ver el enlace "Ver ficha completa…" dentro del contenido).
 */
export function ManagedDatabaseMigrationsPage() {
  const params = useParams()
  const databaseId = Number(params.databaseId)
  const validId = Number.isFinite(databaseId) && databaseId > 0

  if (!validId) {
    return <ErrorState error={new Error('Identificador de base de datos inválido.')} />
  }

  return <ManagedDatabaseMigrationsContent databaseId={databaseId} />
}
