import { useState } from 'react'
import { ConfirmDialog, Switch } from '@/components/ui'
import type { ManagedDatabaseOut } from '@/lib/contracts'
import { useDeleteManagedDatabase } from '../hooks/use-managed-databases'

interface DeleteManagedDatabaseDialogProps {
  /** Montar solo cuando hay una BD objetivo (estado fresco por apertura). */
  database: ManagedDatabaseOut
  onClose: () => void
}

/**
 * Borrado de BD. Si se activa `drop_remote`, exige reescribir el nombre exacto
 * (doble confirmación, §9) antes de ejecutar `DROP DATABASE`.
 */
export function DeleteManagedDatabaseDialog({
  database,
  onClose,
}: DeleteManagedDatabaseDialogProps) {
  const [dropRemote, setDropRemote] = useState(false)
  const deleteDatabase = useDeleteManagedDatabase()

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        deleteDatabase.mutate(
          { id: database.id, dropRemote, confirmName: dropRemote ? database.name : undefined },
          { onSuccess: onClose },
        )
      }}
      title="Eliminar base de datos"
      description={
        dropRemote
          ? 'Se ejecutará DROP DATABASE en el servidor destino. Esta acción es irreversible.'
          : 'Se eliminará del inventario; la base de datos seguirá existiendo en el motor.'
      }
      confirmWord={dropRemote ? database.name : undefined}
      confirmLabel="Eliminar"
      isLoading={deleteDatabase.isPending}
    >
      <Switch
        checked={dropRemote}
        onCheckedChange={setDropRemote}
        label="Eliminar también del motor (DROP DATABASE) 🔌"
        hint="Requiere reescribir el nombre de la base de datos para confirmar."
      />
    </ConfirmDialog>
  )
}
