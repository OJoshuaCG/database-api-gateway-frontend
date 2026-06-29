import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Combobox, Input, Modal, Textarea } from '@/components/ui'
import { fromSnapshotInSchema, type ServerOut } from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerDatabases } from '@/features/servers/hooks/use-introspection'
import { useCreateModelFromSnapshot } from '../hooks/use-from-snapshot'

interface FromSnapshotModalProps {
  open: boolean
  onClose: () => void
  /** Preselección cuando se lanza desde el visor de snapshot de una BD concreta. */
  presetServerId?: number
  presetDatabase?: string
}

/** Genera un slug estable a partir del nombre (kebab en minúsculas). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Crea un blueprint baseline desde el snapshot de una BD existente (Plan 09 §6). Pide servidor +
 * BD + nombre/slug; al crearlo navega a la página de versiones del nuevo blueprint para revisar y
 * aprobar el baseline `0001`.
 */
export function FromSnapshotModal({
  open,
  onClose,
  presetServerId,
  presetDatabase,
}: FromSnapshotModalProps) {
  const navigate = useNavigate()
  const servers = useServerOptions()
  const create = useCreateModelFromSnapshot()

  const [server, setServer] = useState<ServerOut | null>(null)
  const [database, setDatabase] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugDirty, setSlugDirty] = useState(false)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const effectiveServerId = presetServerId ?? server?.id ?? null
  const databases = useServerDatabases(
    effectiveServerId ?? 0,
    open && presetServerId === undefined && Boolean(effectiveServerId),
  )

  const reset = () => {
    setServer(null)
    setDatabase(null)
    setName('')
    setSlug('')
    setSlugDirty(false)
    setDescription('')
    setErrors({})
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugDirty) setSlug(slugify(value))
  }

  const submit = () => {
    const body = {
      server_id: effectiveServerId ?? 0,
      database: presetDatabase ?? database ?? '',
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
    }
    const parsed = fromSnapshotInSchema.safeParse(body)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    create.mutate(parsed.data, {
      onSuccess: (result) => {
        handleClose()
        navigate(`/database-models/${result.model.id}/migrations`)
      },
    })
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Crear blueprint desde snapshot"
      description="Captura la estructura de una BD existente como baseline versionado. Solo estructura, nunca datos."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {presetServerId === undefined && (
          <Combobox<ServerOut>
            items={servers.data ?? []}
            value={server}
            onChange={(value) => {
              setServer(value)
              setDatabase(null)
            }}
            itemToString={(s) => s.name}
            itemToKey={(s) => s.id}
            label="Servidor"
            placeholder="Selecciona el servidor de origen"
            isLoading={servers.isLoading}
            error={errors.server_id}
            required
          />
        )}

        {presetDatabase === undefined && (
          <Combobox<string>
            items={databases.data ?? []}
            value={database}
            onChange={setDatabase}
            itemToString={(d) => d}
            itemToKey={(d) => d}
            label="Base de datos"
            placeholder={effectiveServerId ? 'Selecciona la BD' : 'Elige un servidor primero'}
            isLoading={databases.isLoading}
            disabled={!effectiveServerId}
            error={errors.database}
            required
          />
        )}

        {(presetServerId !== undefined || presetDatabase !== undefined) && (
          <p className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
            Origen: servidor #{effectiveServerId} · BD <code>{presetDatabase}</code>
          </p>
        )}

        <Input
          label="Nombre del blueprint"
          required
          value={name}
          onChange={(event) => handleNameChange(event.target.value)}
          error={errors.name}
        />
        <Input
          label="Slug"
          required
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value)
            setSlugDirty(true)
          }}
          hint="Identificador estable (kebab/snake en minúsculas)."
          error={errors.slug}
        />
        <Textarea
          label="Descripción (opcional)"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} isLoading={create.isPending}>
            Crear desde snapshot 🔌
          </Button>
        </div>
      </div>
    </Modal>
  )
}
