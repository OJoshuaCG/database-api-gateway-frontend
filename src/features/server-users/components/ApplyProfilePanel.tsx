import { useState } from 'react'
import { Button, Combobox, EmptyState, ErrorState, Input, Spinner } from '@/components/ui'
import type {
  EngineType,
  ObjectMapping,
  PermissionProfileOut,
  ServerUserOut,
} from '@/lib/contracts'
import { usePermissionProfileOptions } from '@/features/permission-profiles'
import { useServerDatabases } from '@/features/servers/hooks/use-introspection'
import { useApplyProfile } from '../hooks/use-user-grants'

interface ApplyProfilePanelProps {
  user: ServerUserOut
  engine: EngineType | null
}

/**
 * Base de datos objetivo: se elige de las BDs que reporta el servidor en vivo 🔌 para no teclear
 * el nombre a ciegas. Si la introspección falla o el motor no devuelve ninguna BD, cae a captura
 * manual: un servidor inalcanzable no debe bloquear la aplicación del perfil.
 */
function TargetDatabaseField({
  serverId,
  value,
  onChange,
}: {
  serverId: number
  value: string
  onChange: (database: string) => void
}) {
  // El padre solo monta este campo cuando el perfil tiene items no globales: la llamada al motor
  // es perezosa por construcción.
  const databases = useServerDatabases(serverId, true)
  const options = databases.data ?? []

  if (databases.isLoading) {
    return (
      <Combobox<string>
        items={[]}
        value={null}
        onChange={() => {}}
        itemToString={(item) => item}
        itemToKey={(item) => item}
        label="Base de datos objetivo"
        placeholder="Cargando bases de datos…"
        isLoading
        required
      />
    )
  }

  if (databases.isError || options.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Input
          label="Base de datos objetivo"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {databases.isError
            ? 'No se pudo consultar las bases de datos del servidor; escribe el nombre a mano.'
            : 'El servidor no reportó bases de datos; escribe el nombre a mano.'}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => void databases.refetch()}
          >
            Reintentar
          </button>
        </p>
      </div>
    )
  }

  return (
    <Combobox<string>
      items={options}
      value={value ? value : null}
      onChange={(database) => onChange(database ?? '')}
      itemToString={(item) => item}
      itemToKey={(item) => item}
      label="Base de datos objetivo"
      placeholder="Selecciona una base de datos"
      clearable
      required
    />
  )
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
          <TargetDatabaseField serverId={user.server_id} value={database} onChange={setDatabase} />
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
