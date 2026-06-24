import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <p className="text-5xl font-semibold text-primary">404</p>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Página no encontrada</h1>
        <p className="text-sm text-muted-foreground">La ruta solicitada no existe.</p>
      </div>
      <Button onClick={() => navigate('/servers')}>Volver al inicio</Button>
    </div>
  )
}
