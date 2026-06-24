import { Modal } from '@/components/ui'
import type { ServerOut } from '@/lib/contracts'
import { useCreateServer, useUpdateServer } from '../hooks/use-server-mutations'
import { ServerForm, toServerCreate, toServerUpdate, type ServerFormValues } from './ServerForm'

function serverToFormValues(server: ServerOut): Partial<ServerFormValues> {
  const ssl = server.ssl_mode
  return {
    name: server.name,
    host: server.host,
    port: server.port,
    engine: server.engine,
    root_username: server.root_username,
    root_password: '',
    ssl_mode: ssl ? ssl : null,
    notes: server.notes ?? '',
    is_active: server.is_active,
  }
}

interface ServerFormModalProps {
  open: boolean
  onClose: () => void
  /** Si se pasa, es edición; si no, creación. */
  server?: ServerOut
}

export function ServerFormModal({ open, onClose, server }: ServerFormModalProps) {
  const mode = server ? 'edit' : 'create'
  const create = useCreateServer()
  const update = useUpdateServer(server?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const handleSubmit = (values: ServerFormValues) => {
    if (server) {
      update.mutate(toServerUpdate(values), { onSuccess: onClose })
    } else {
      create.mutate(toServerCreate(values), { onSuccess: onClose })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={server ? 'Editar servidor' : 'Registrar servidor'}
      description={
        server
          ? 'Actualiza los datos del servidor en el inventario.'
          : 'Registra un nuevo servidor destino. La credencial pseudo-root se cifra al guardar.'
      }
      size="lg"
    >
      <ServerForm
        mode={mode}
        defaultValues={server ? serverToFormValues(server) : undefined}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
