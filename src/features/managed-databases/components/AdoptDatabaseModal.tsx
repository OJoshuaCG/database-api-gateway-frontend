import { useState } from 'react'
import { Button, Combobox, Input, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { PAGINATION } from '@/lib/contracts'
import type { DatabaseModelOut, ServerUserOut } from '@/lib/contracts'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'
import { useModelMigrations } from '@/features/database-models/hooks/use-model-migrations'
import { useAdoptDatabase } from '../hooks/use-adopt-database'

interface AdoptDatabaseModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  /** Nombre EXACTO de la BD existente (precargado desde la fila de reconciliación). */
  databaseName: string
}

/**
 * Opción del selector de "versión de partida". `version === null` es la opción sintética
 * "Vacía / en ceros": adopta sin declarar versión (no se hace stamp).
 */
interface VersionOption {
  key: string
  label: string
  version: string | null
}

const EMPTY_VERSION: VersionOption = {
  key: '__empty__',
  label: 'Vacía / en ceros (sin marcar)',
  version: null,
}

/**
 * Adopta una BD existente (Plan 09 §3): la registra en el inventario sin recrearla. Exige un
 * propietario (ServerUser del mismo servidor) y, opcionalmente, vincula un blueprint.
 *
 * Cambio 1: si se elige un blueprint, aparece un selector dependiente de "versión de partida"
 * (la versión en la que la BD ya se encuentra). Declararla hace que el gateway marque (stamp) esa
 * versión sin ejecutar SQL, evitando que un `apply` posterior reintente crear objetos existentes.
 */
export function AdoptDatabaseModal({
  open,
  onClose,
  serverId,
  databaseName,
}: AdoptDatabaseModalProps) {
  const owners = useServerUserOptions(serverId)
  const models = useDatabaseModelOptions()
  const adopt = useAdoptDatabase()

  const [owner, setOwner] = useState<ServerUserOut | null>(null)
  const [model, setModel] = useState<DatabaseModelOut | null>(null)
  const [version, setVersion] = useState<VersionOption>(EMPTY_VERSION)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Error del backend (detail.msg) con matiz por código; separado del error de validación local.
  const [submitError, setSubmitError] = useState<string | null>(null)

  // El selector de versión solo tiene sentido con un blueprint elegido; se puebla al vuelo.
  const migrations = useModelMigrations(
    model?.id ?? 0,
    { page: 1, size: PAGINATION.maxSize },
    open && model != null,
  )
  const versionSummaries = migrations.data?.items ?? []
  const hasNoVersions = model != null && !migrations.isLoading && versionSummaries.length === 0
  const versionOptions: VersionOption[] = [
    EMPTY_VERSION,
    ...versionSummaries.map((m) => ({
      key: m.version,
      label: `${m.version} · ${m.name}`,
      version: m.version,
    })),
  ]

  const handleClose = () => {
    setOwner(null)
    setModel(null)
    setVersion(EMPTY_VERSION)
    setNotes('')
    setError(null)
    setSubmitError(null)
    onClose()
  }

  // Al cambiar de blueprint, la versión previa deja de ser válida: se resetea a "vacía".
  const handleModelChange = (next: DatabaseModelOut | null) => {
    setModel(next)
    setVersion(EMPTY_VERSION)
  }

  const submit = () => {
    if (!owner) {
      setError('Selecciona un propietario.')
      return
    }
    setError(null)
    setSubmitError(null)
    adopt.mutate(
      {
        name: databaseName,
        server_id: serverId,
        owner_id: owner.id,
        model_id: model?.id ?? null,
        // `model_version` solo se envía si hay blueprint y una versión concreta (no "vacía").
        model_version: model && version.version ? version.version : null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: handleClose,
        onError: (err) => {
          const apiError = toApiError(err)
          // Matiz por código sobre el detail.msg del backend (el hook además muestra el toast).
          const hint =
            apiError.status === 422
              ? ' La base de datos NO quedó registrada: corrige y reintenta.'
              : apiError.status === 409
                ? ' Esta BD ya está adoptada; búscala en la lista de bases de datos.'
                : apiError.status === 404
                  ? ' Revisa que el nombre coincida exactamente con la BD del motor.'
                  : ''
          setSubmitError(apiError.message + hint)
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Adoptar base de datos"
      description="Registra una BD que ya existe en el motor, sin recrearla ni tocar sus datos."
      size="md"
    >
      <div className="flex flex-col gap-4">
        <Input label="Nombre" value={databaseName} readOnly />
        <Combobox<ServerUserOut>
          items={owners.data ?? []}
          value={owner}
          onChange={setOwner}
          itemToString={(u) => (u.host ? `${u.username}@${u.host}` : u.username)}
          itemToKey={(u) => u.id}
          label="Propietario"
          placeholder="Elige un ServerUser de este servidor"
          isLoading={owners.isLoading}
          error={error ?? undefined}
          required
        />
        <p className="text-xs text-muted-foreground">
          ¿No aparece el propietario? Adóptalo primero desde la pestaña Usuarios.
        </p>
        <Combobox<DatabaseModelOut>
          items={models.data ?? []}
          value={model}
          onChange={handleModelChange}
          itemToString={(m) => m.name}
          itemToKey={(m) => m.id}
          label="Blueprint (opcional)"
          placeholder="Ninguno"
          isLoading={models.isLoading}
          clearable
        />

        {model != null && (
          <div className="flex flex-col gap-2">
            <Combobox<VersionOption>
              items={versionOptions}
              value={version}
              onChange={(next) => setVersion(next ?? EMPTY_VERSION)}
              itemToString={(o) => o.label}
              itemToKey={(o) => o.key}
              label="Versión de partida"
              placeholder="Vacía / en ceros (sin marcar)"
              isLoading={migrations.isLoading}
              disabled={hasNoVersions}
            />
            {hasNoVersions && (
              <p className="text-xs text-muted-foreground">
                Este blueprint aún no tiene versiones: se adoptará «en ceros».
              </p>
            )}
            {version.version && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs text-foreground">
                Se marcará (stamp) la versión <code>{version.version}</code> en el motor{' '}
                <strong>sin ejecutar SQL</strong>. Úsalo solo si el esquema de la BD ya coincide con
                esa versión.
              </p>
            )}
          </div>
        )}

        <Textarea
          label="Notas (opcional)"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {submitError && (
          <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
            {submitError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={adopt.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} isLoading={adopt.isPending}>
            Adoptar 🔌
          </Button>
        </div>
      </div>
    </Modal>
  )
}
