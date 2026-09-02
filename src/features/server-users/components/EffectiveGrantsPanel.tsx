import { useState } from 'react'
import {
  Badge,
  Callout,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import type { EngineType, GrantInfo } from '@/lib/contracts'
import { ServerDatabaseCombobox } from '@/features/servers/components/ServerDatabaseCombobox'
import { useIdentityGrants } from '@/features/servers/hooks/use-identity-grants'
import { useUserGrants } from '../hooks/use-user-grants'
import { filterGrantsByDatabase } from './grant-logic'

interface EffectiveGrantsPanelProps {
  serverId: number
  username: string
  host: string | undefined
  engine: EngineType
  /** Id de inventario, si la identidad está adoptada. */
  serverUserId: number | undefined
}

/**
 * Permisos efectivos según la introspección del motor 🔌.
 *
 * Consulta por **dos** caminos según haya fila de inventario o no, y eso es deliberado
 * (api-reference-v21 §2): con `server_user_id` va por `/server-users/{id}/grants`, que sigue
 * siendo el camino natural; sin él va por `/servers/{id}/users/grants`, el endpoint por identidad
 * que v21 añadió y **no exige adopción**. Gracias a eso esta pestaña ya funciona sobre una
 * identidad `unmanaged`: auditar qué puede hacer un usuario no debería obligar a adoptarlo antes.
 *
 * El filtro por base tampoco es simétrico (§3): PostgreSQL lo exige y el backend acota la
 * respuesta; MySQL/MariaDB lo ignora y devuelve el servidor entero, así que ahí el recorte lo
 * hace el cliente. Por eso en MySQL el parámetro ni se manda: variaría la clave de caché para
 * pedir exactamente la misma respuesta.
 */
export function EffectiveGrantsPanel({
  serverId,
  username,
  host,
  engine,
  serverUserId,
}: EffectiveGrantsPanelProps) {
  const [database, setDatabase] = useState('')
  const isPg = engine === 'postgresql'
  const isAdopted = serverUserId != null

  const selected = database.trim()
  const backendDatabase = isPg ? selected || undefined : undefined
  const needsDatabase = isPg && !selected

  const adopted = useUserGrants(serverUserId ?? 0, backendDatabase, isAdopted, isPg)
  const identity = useIdentityGrants(serverId, username, host, backendDatabase, !isAdopted, isPg)

  const query = isAdopted ? adopted : identity
  const rawGrants: GrantInfo[] = isAdopted ? (adopted.data ?? []) : (identity.data?.grants ?? [])
  const grants = !isPg && selected ? filterGrantsByDatabase(rawGrants, selected) : rawGrants
  const clientFiltered = !isPg && Boolean(selected) && grants.length !== rawGrants.length

  return (
    <div className="flex flex-col gap-3">
      <div className="w-full sm:max-w-sm">
        <ServerDatabaseCombobox
          serverId={serverId}
          value={database}
          onChange={setDatabase}
          required={isPg}
          hint={
            isPg
              ? 'PostgreSQL la exige: los grants de objeto viven dentro de una base.'
              : 'Opcional. El motor devuelve todo el servidor; el filtro se aplica acá.'
          }
        />
      </div>

      {needsDatabase ? (
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          Indicá una base de datos para consultar los permisos: PostgreSQL la exige para los grants
          de objeto.
        </p>
      ) : query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando permisos…
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : grants.length === 0 ? (
        <EmptyState
          title="Sin permisos efectivos"
          description={
            selected
              ? `«${username}» no tiene privilegios sobre «${selected}».`
              : 'Este usuario no tiene privilegios otorgados en el motor.'
          }
        />
      ) : (
        <>
          {clientFiltered && (
            <Callout tone="info" title={`Filtrado por «${selected}» en el navegador`}>
              En MySQL/MariaDB el backend ignora el parámetro de base y responde con los grants del
              usuario en todo el servidor. Se muestran los de esta base más los de nivel global, que
              aplican a todas.
            </Callout>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {grants.map((grant, index) => (
              <li
                key={`${grant.level}-${grant.object ?? ''}-${index}`}
                className="flex flex-col gap-1 py-2"
              >
                <div className="flex items-center gap-2">
                  <Badge tone="info">{grant.level}</Badge>
                  <span className="text-sm font-medium text-foreground">
                    {grant.object ?? '(global)'}
                  </span>
                  {grant.with_grant_option && <Badge tone="warning">WITH GRANT</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">{grant.privileges.join(', ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex justify-end">
        {/* Un botón `disabled` no dispara el tooltip nativo, así que sin este `span` el icono
            quedaría gris y mudo cuando falta la BD en PostgreSQL. */}
        <span
          title={
            needsDatabase
              ? 'Indicá una base de datos para poder actualizar los permisos.'
              : undefined
          }
        >
          <IconButton
            type="button"
            label="Actualizar"
            icon={<RefreshIcon />}
            variant="outline"
            size="icon-sm"
            onClick={() => void query.refetch()}
            isLoading={query.isFetching}
            disabled={needsDatabase}
          />
        </span>
      </div>
    </div>
  )
}
