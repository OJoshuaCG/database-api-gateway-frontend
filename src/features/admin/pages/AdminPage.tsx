import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  PageHeader,
} from '@/components/ui'
import { useRotateCrypto } from '../hooks/use-crypto-rotation'

export function AdminPage() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const rotate = useRotateCrypto()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Administración"
        description="Operaciones sensibles sobre la plataforma. Opera sobre la BD de metadatos del gateway."
      />

      <Card>
        <CardHeader>
          <CardTitle>Rotación de cifrado (DEK)</CardTitle>
          <CardDescription>
            Rota la clave de datos y re-cifra todas las credenciales almacenadas (servidores y
            usuarios), sin cambiar la SECRET_KEY ni reiniciar la aplicación.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rotate.data && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">
                {rotate.data.servers_reencrypted} servidor(es) re-cifrados
              </Badge>
              <Badge tone="success">
                {rotate.data.server_users_reencrypted} usuario(s) re-cifrados
              </Badge>
            </div>
          )}
          <div>
            <Button onClick={() => setConfirmOpen(true)} isLoading={rotate.isPending}>
              Rotar clave de cifrado
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
          })
        }
        title="Rotar la clave de cifrado"
        description="Se re-cifrarán todas las credenciales. La operación puede tardar según el volumen de datos."
        confirmLabel="Rotar ahora"
        tone="primary"
        isLoading={rotate.isPending}
      />
    </div>
  )
}
