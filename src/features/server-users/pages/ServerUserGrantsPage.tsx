import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDebouncedValue } from '@/lib/utils/use-debounced-value'
import {
  Badge,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  IconButton,
  Input,
  PageHeader,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import type { EngineType, ServerUserOut } from '@/lib/contracts'
import { useServer } from '@/features/servers/hooks/use-servers'
import { useServerUser } from '../hooks/use-server-users'
import { useUserGrants } from '../hooks/use-user-grants'
import { GrantManager } from '../components/GrantManager'
import { ApplyProfilePanel } from '../components/ApplyProfilePanel'

const TABS = ['effective', 'manage', 'profile'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

const TAB_LABELS: Record<Tab, string> = {
  effective: 'Permisos efectivos',
  manage: 'Otorgar / revocar',
  profile: 'Aplicar perfil',
}

/** Origen por defecto: la lista de usuarios del motor, de donde se entra en el caso normal. */
const DEFAULT_BACK = '/server-users'

/**
 * Destino del enlace «volver». Llega en `?from=` porque a esta página se entra desde dos sitios
 * distintos (la lista `/server-users` y la pestaña «Usuarios» del detalle de servidor) y cada uno
 * tiene que recuperar SU vista, incluida la pestaña que estaba abierta.
 *
 * Solo se acepta una ruta interna: debe empezar por `/` y **no** por `//` ni `/\`, que el
 * navegador resolvería como URL protocol-relative hacia otro dominio — es decir, un redirect
 * abierto a un sitio externo controlado por quien fabrique el enlace.
 */
function resolveBackTo(from: string | null): string {
  if (from === null || !from.startsWith('/')) return DEFAULT_BACK
  if (from.startsWith('//') || from.startsWith('/\\')) return DEFAULT_BACK
  return from
}

/** El texto nombra el destino real (no un «volver» genérico) para que el admin sepa a dónde va. */
function backLabel(to: string): string {
  return to === '/servers' || to.startsWith('/servers/') ? '← Servidor' : '← Usuarios del motor'
}

/**
 * Página de permisos de un usuario del motor (§7): permisos efectivos, otorgar/revocar y aplicar
 * un perfil 🔌. Antes era un modal; como página cada usuario tiene su propia URL —lo que hace
 * innecesario el `key={user.id}` que reiniciaba el estado entre filas, porque el remonte lo da
 * ahora la ruta— y se puede enlazar directamente a una pestaña concreta.
 */
export function ServerUserGrantsPage() {
  const params = useParams()
  const userId = Number(params.userId)
  const isValidId = Number.isFinite(userId)

  const user = useServerUser(userId, isValidId)

  if (!isValidId) {
    return <ErrorState error={new Error('Identificador de usuario inválido.')} />
  }
  if (user.isLoading) return <FullPageSpinner label="Cargando usuario" />
  if (user.isError || !user.data) {
    return <ErrorState error={user.error} onRetry={() => void user.refetch()} />
  }

  // El motor se resuelve en un componente aparte porque `useServer` necesita el `server_id` del
  // usuario: pedirlo aquí obligaría a inventar un id falso mientras el usuario carga (y a lanzar
  // un GET /servers/0 que siempre falla).
  return <ServerUserGrantsContent user={user.data} />
}

function ServerUserGrantsContent({ user }: { user: ServerUserOut }) {
  const server = useServer(user.server_id)
  // La pestaña vive en la URL (`?tab=`), no en estado local: así se puede enlazar a una pestaña
  // concreta. Un valor desconocido cae en `effective` en vez de dejar la página en blanco.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'effective'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }

  const backTo = resolveBackTo(searchParams.get('from'))

  if (server.isLoading) return <FullPageSpinner label="Cargando servidor" />
  if (server.isError || !server.data) {
    return <ErrorState error={server.error} onRetry={() => void server.refetch()} />
  }

  const engine = server.data.engine
  const identity = `${user.username}${user.host ? `@${user.host}` : ''}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel(backTo)}
        </Link>
        <PageHeader
          title={identity}
          description={`Permisos del usuario en «${server.data.name}» (${engine}): introspección de lo que tiene hoy, otorgar o revocar privilegios y aplicar un perfil. Todas las acciones tocan el motor real 🔌.`}
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone={user.is_active ? 'success' : 'neutral'}>
            {user.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
          <Badge tone={user.has_password ? 'success' : 'warning'}>
            {user.has_password ? 'Contraseña conocida' : 'Contraseña no conocida'}
          </Badge>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map((item) => (
          <TabButton key={item} active={tab === item} onClick={() => setTab(item)}>
            {TAB_LABELS[item]}
          </TabButton>
        ))}
      </div>

      {tab === 'effective' && <EffectiveGrantsPanel user={user} engine={engine} />}
      {tab === 'manage' && <GrantManager user={user} engine={engine} />}
      {tab === 'profile' && <ApplyProfilePanel user={user} engine={engine} />}
    </div>
  )
}

/** Permisos efectivos del usuario según la introspección del motor 🔌. */
function EffectiveGrantsPanel({ user, engine }: { user: ServerUserOut; engine: EngineType }) {
  const [databaseDraft, setDatabaseDraft] = useState('')
  const database = useDebouncedValue(databaseDraft, 400)
  const isPg = engine === 'postgresql'

  // PostgreSQL exige `?database=` para la introspección de grants: sin BD la query no se
  // dispara (queda gateada en el hook) y en su lugar se muestra el hint de abajo.
  const needsDatabase = isPg && !database.trim()
  const grants = useUserGrants(user.id, database.trim() || undefined, true, isPg)

  return (
    <div className="flex flex-col gap-3">
      {isPg && (
        <Input
          label="Base de datos"
          hint="PostgreSQL: obligatoria para ver grants de tablas/columnas/secuencias/rutinas."
          value={databaseDraft}
          onChange={(event) => setDatabaseDraft(event.target.value)}
          placeholder="app_prod"
        />
      )}
      {needsDatabase ? (
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          Indicá una base de datos para consultar los permisos (PostgreSQL la exige para los grants
          de objeto).
        </p>
      ) : grants.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando permisos…
        </div>
      ) : grants.isError ? (
        <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />
      ) : (grants.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Sin permisos efectivos"
          description="Este usuario no tiene privilegios otorgados (o no en la BD indicada)."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {grants.data?.map((grant, index) => (
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
      )}
      <div className="flex justify-end">
        {/* Un botón `disabled` no dispara el tooltip nativo, así que sin este `span` el
            icono quedaría gris y mudo cuando falta la BD en PostgreSQL. Mismo recurso que
            usa `ModelMigrationDetailPanel` para explicar por qué no se puede pulsar. */}
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
            onClick={() => void grants.refetch()}
            isLoading={grants.isFetching}
            disabled={needsDatabase}
          />
        </span>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? '-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
          : '-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}
