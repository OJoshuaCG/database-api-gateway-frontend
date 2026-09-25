import { useState } from 'react'
import { ConfirmDialog, Switch } from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { CAPABILITIES, type ManagedDatabaseOut } from '@/lib/contracts'
import { useDeleteManagedDatabase } from '../hooks/use-managed-databases'

interface DeleteManagedDatabaseDialogProps {
  /** Montar solo cuando hay una BD objetivo (estado fresco por apertura). */
  database: ManagedDatabaseOut
  /**
   * Si se pinta el switch «Eliminar también del motor». Lo decide `allowsEngineDropOnRemove`:
   * solo en la fila del inventario de una base activa. Donde hay un «Eliminar del motor 🔌» al
   * lado (ficha, listado físico) ese es el camino, porque pasa por el preview, las conexiones
   * activas y el `confirm_token`, y este switch no; y donde la base no está en el motor no hay
   * nada que borrar.
   */
  allowEngineDrop: boolean
  onClose: () => void
}

/**
 * «Quitar del inventario»: por defecto solo borra el registro del gateway y la base sigue en el
 * motor. Si se activa `drop_remote`, exige reescribir el nombre exacto (doble confirmación, §9)
 * antes de ejecutar `DROP DATABASE`.
 *
 * El título y el botón nombran la consecuencia (R5 de `database-actions.ts`) y cambian con el
 * switch: el mismo diálogo hace dos cosas de gravedad muy distinta, y un «Eliminar» fijo no
 * distinguía cuál se iba a confirmar.
 */
export function DeleteManagedDatabaseDialog({
  database,
  allowEngineDrop,
  onClose,
}: DeleteManagedDatabaseDialogProps) {
  const [dropRemote, setDropRemote] = useState(false)
  // `drop_remote=true` SUBE el requisito (v23 §4): quitarla del inventario pide
  // `databases.write`, pero el DROP DATABASE sobre el motor pide `databases.drop`. Se
  // deshabilita el control en vez de dejar que el 403 llegue después de re-tipear el nombre.
  const dropGuard = useCapabilityGuard(CAPABILITIES.databasesDrop, 'eliminar bases del motor')
  const deleteDatabase = useDeleteManagedDatabase()

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        deleteDatabase.mutate(
          {
            id: database.id,
            serverId: database.server_id,
            dropRemote,
            confirmName: dropRemote ? database.name : undefined,
          },
          { onSuccess: onClose },
        )
      }}
      title={dropRemote ? 'Quitar del inventario y eliminar del motor 🔌' : 'Quitar del inventario'}
      description={
        dropRemote
          ? 'Se ejecutará DROP DATABASE en el servidor destino. Esta acción es irreversible.'
          : 'Se eliminará del inventario; la base de datos seguirá existiendo en el motor.'
      }
      confirmWord={dropRemote ? database.name : undefined}
      confirmLabel={dropRemote ? 'Eliminar del motor 🔌' : 'Quitar del inventario'}
      isLoading={deleteDatabase.isPending}
    >
      {allowEngineDrop && (
        <Switch
          checked={dropRemote}
          onCheckedChange={setDropRemote}
          disabled={!dropGuard.allowed}
          label="Eliminar también del motor (DROP DATABASE) 🔌"
          hint={
            dropGuard.hint ?? 'Requiere reescribir el nombre de la base de datos para confirmar.'
          }
        />
      )}
    </ConfirmDialog>
  )
}
