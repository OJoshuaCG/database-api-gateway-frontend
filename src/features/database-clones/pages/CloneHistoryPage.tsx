import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, PageHeader, TabButton } from '@/components/ui'
import { CloneHistoryTab } from '../components/CloneHistoryTab'
import { CloneBatchHistoryTab } from '../components/CloneBatchHistoryTab'

type HistoryTab = 'individuales' | 'lotes'

/**
 * «Clonaciones» — el aterrizaje del módulo, y el punto del que ninguna operación se puede
 * escapar.
 *
 * Antes esta ruta era el asistente en blanco. El encuadre estaba invertido: había dos entradas
 * de menú que decían «empezar algo nuevo» y ninguna que dijera «ver lo que hay», mientras que la
 * operación que se repite no es lanzar un clon sino volver a mirar uno. Con el id del job
 * viviendo solo en el estado de React y sin endpoint de listado, salirse de la vista dejaba la
 * operación INALCANZABLE.
 */
export function CloneHistoryPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<HistoryTab>(
    params.get('tab') === 'lotes' ? 'lotes' : 'individuales',
  )

  // Enlaces viejos: son los únicos que alguien pudo haberse guardado, así que siguen llevando a
  // donde llevaban. Se redirige con `replace` para no dejar una entrada muerta en el historial
  // del navegador.
  const jobIdViejo = params.get('jobId')
  if (jobIdViejo && /^\d+$/.test(jobIdViejo)) {
    return <Navigate to={`/database-clones/${jobIdViejo}`} replace />
  }
  const sourceIdViejo = params.get('sourceDatabaseId')
  if (sourceIdViejo && /^\d+$/.test(sourceIdViejo)) {
    return <Navigate to={`/database-clones/nuevo?sourceDatabaseId=${sourceIdViejo}`} replace />
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clonaciones"
        description="Historial de clonaciones individuales y de lote. Toda operación queda registrada acá, aunque cierres la pestaña."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/database-clones/nuevo')}>
              Clonar base de datos
            </Button>
            <Button variant="outline" onClick={() => navigate('/database-clones/lotes/nuevo')}>
              Clonar varias bases
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1">
        <TabButton active={tab === 'individuales'} onClick={() => setTab('individuales')}>
          Individuales
        </TabButton>
        <TabButton active={tab === 'lotes'} onClick={() => setTab('lotes')}>
          Lotes
        </TabButton>
      </div>

      <Card>
        <CardContent>
          {tab === 'individuales' ? <CloneHistoryTab /> : <CloneBatchHistoryTab />}
        </CardContent>
      </Card>
    </div>
  )
}
