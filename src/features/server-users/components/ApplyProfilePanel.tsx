import { useState } from 'react'
import { Button, Combobox, EmptyState, ErrorState, Input, Spinner } from '@/components/ui'
import type {
  EngineType,
  ObjectMapping,
  PermissionProfileOut,
  ServerUserOut,
} from '@/lib/contracts'
import { usePermissionProfileOptions } from '@/features/permission-profiles'
import { useApplyProfile } from '../hooks/use-user-grants'

interface ApplyProfilePanelProps {
  user: ServerUserOut
  engine: EngineType | null
}

/**
 * Aplica un perfil de permisos a un usuario sobre una base de datos objetivo (§7). Construye
 * un `object_mapping` por cada nivel del perfil usando la BD/esquema indicados.
 */
export function ApplyProfilePanel({ user, engine }: ApplyProfilePanelProps) {
  const isPg = engine === 'postgresql'
  const profiles = usePermissionProfileOptions(engine)
  const apply = useApplyProfile(user.id)

  const [profile, setProfile] = useState<PermissionProfileOut | null>(null)
  const [database, setDatabase] = useState('')
  const [schema, setSchema] = useState('public')

  const needsDatabase = (profile?.items ?? []).some((item) => item.level !== 'global')
  const canApply = profile !== null && (!needsDatabase || database.trim().length > 0)

  function handleApply() {
    if (!profile) return
    const objectMappings: ObjectMapping[] = profile.items.map((item) => {
      if (item.level === 'global') return { level: item.level, object_ref: {} }
      return {
        level: item.level,
        object_ref: {
          database: database.trim() || undefined,
          ...(isPg ? { schema: schema.trim() || 'public' } : {}),
        },
      }
    })
    apply.mutate({ profileId: profile.id, body: { object_mappings: objectMappings } })
  }

  if (profiles.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando perfiles…
      </div>
    )
  }

  if (profiles.isError) {
    return <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />
  }

  if ((profiles.data?.length ?? 0) === 0) {
    return (
      <EmptyState
        title="No hay perfiles para este motor"
        description="Crea un perfil de permisos compatible con el motor del servidor."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Combobox<PermissionProfileOut>
        items={profiles.data ?? []}
        value={profile}
        onChange={setProfile}
        itemToString={(option) => `${option.name} (${option.items.length} item/s)`}
        itemToKey={(option) => option.id}
        label="Perfil de permisos"
        placeholder="Selecciona un perfil…"
        clearable
      />

      {needsDatabase && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Base de datos objetivo"
            required
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
          />
          {isPg && (
            <Input
              label="Esquema"
              hint="PostgreSQL; default «public»."
              value={schema}
              onChange={(event) => setSchema(event.target.value)}
            />
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={handleApply} disabled={!canApply} isLoading={apply.isPending}>
          Aplicar perfil
        </Button>
      </div>
    </div>
  )
}
