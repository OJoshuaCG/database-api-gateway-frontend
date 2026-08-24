import { ConfirmDialog } from '@/components/ui'
import type { ManagedDatabaseOut } from '@/lib/contracts'
import { useProvisionManagedDatabase } from '../hooks/use-managed-databases'

interface ProvisionDatabaseDialogProps {
  /** Montar solo cuando hay una BD objetivo (estado fresco por apertura). */
  database: ManagedDatabaseOut
  serverName?: string
  onClose: () => void
}

/**
 * Aprovisiona en el motor 🔌 una BD que figura en el inventario pero no existe físicamente.
 *
 * No es destructivo —crea una base vacía—, así que no exige reescribir el nombre como el
 * borrado: alcanza con una confirmación que diga QUÉ base y en QUÉ servidor, para que un click
 * perdido en una fila no dispare DDL contra el servidor equivocado.
 *
 * `allow_recreate` se manda solo desde el estado `active`, que es el caso «alguien la borró por
 * fuera del gateway»: ahí el backend exige el gesto explícito para no tapar ese borrado.
 */
export function ProvisionDatabaseDialog({
  database,
  serverName,
  onClose,
}: ProvisionDatabaseDialogProps) {
  const provision = useProvisionManagedDatabase()
  const isRecreate = database.status === 'active'

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        provision.mutate(
          { id: database.id, allowRecreate: isRecreate },
          { onSuccess: onClose },
        )
      }}
      title={isRecreate ? 'Recrear base de datos en el motor' : 'Aprovisionar base de datos'}
      description={
        isRecreate
          ? `Se ejecutará CREATE DATABASE de «${database.name}» en ${serverName ?? 'el servidor'}. ` +
            'El inventario ya la marca como activa: confirmá solo si sabés que la borraron ' +
            'por fuera del gateway.'
          : `Se ejecutará CREATE DATABASE de «${database.name}» en ${serverName ?? 'el servidor'}. ` +
            'No se otorgan privilegios ni se aplican las migraciones del blueprint: son pasos ' +
            'aparte.'
      }
      confirmLabel={isRecreate ? 'Recrear' : 'Aprovisionar'}
      tone="primary"
      isLoading={provision.isPending}
    />
  )
}
