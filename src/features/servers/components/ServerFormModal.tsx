import { Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { ServerOut } from '@/lib/contracts'
import { useCreateServer, useUpdateServer } from '../hooks/use-server-mutations'
import { serverRebindErrorMessage, type RebindBaseline } from '../server-rebind'
import {
  ServerForm,
  toServerCreate,
  toServerUpdate,
  type ServerFormHelpers,
  type ServerFormValues,
} from './ServerForm'

/** Lo que el backend compara para decidir si el cambio re-apunta la credencial guardada. */
function serverToRebindBaseline(server: ServerOut): RebindBaseline {
  return {
    host: server.host,
    port: server.port,
    engine: server.engine,
    ssl_mode: server.ssl_mode ? server.ssl_mode : null,
  }
}

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

  const handleSubmit = (values: ServerFormValues, form: ServerFormHelpers) => {
    if (server) {
      update.mutate(toServerUpdate(values), {
        onSuccess: onClose,
        // El 422 de re-apuntado deja el modal abierto con la contraseña marcada y enfocada: es el
        // único campo que falta para que el mismo envío pase. El toast lo da el hook.
        onError: (error) => {
          const message = serverRebindErrorMessage(toApiError(error))
          if (message) form.requirePassword(message)
        },
      })
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
        original={server ? serverToRebindBaseline(server) : undefined}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
