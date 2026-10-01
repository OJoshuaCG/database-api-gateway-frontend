import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader, TabButton } from '@/components/ui'
import {
  EffectiveAccessPanel,
  ROLES_MATRIX_PATH,
  SessionsPanel,
  useCapabilities,
  useCapabilityCatalog,
  useSession,
  type EffectiveAccessGrant,
} from '@/features/auth'
import { useEnvironmentMap } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'

const TABS = ['acceso', 'sesiones'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/**
 * «Mi cuenta» — autoservicio de la propia sesión: qué acceso tengo y dónde está abierta.
 *
 * «Mi acceso» existe para que nadie tenga que pedirle a un administrador que le lea su rol: el
 * mismo cálculo que ve quien administra accesos, sobre `/auth/me`, sin nada editable. Y es el
 * destino del enlace «Ver mi acceso» de todo 403.
 */
export function MyAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'acceso'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }
  const { admin } = useSession()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mi cuenta"
        description={
          admin ? `Sesión de ${admin.username}: tu acceso y dónde está abierta.` : undefined
        }
      />
      <div
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label="Secciones de mi cuenta"
      >
        <TabButton active={tab === 'acceso'} onClick={() => setTab('acceso')}>
          Mi acceso
        </TabButton>
        <TabButton active={tab === 'sesiones'} onClick={() => setTab('sesiones')}>
          Mis sesiones
        </TabButton>
      </div>
      {tab === 'acceso' ? <MyAccessPanel /> : <SessionsPanel />}
    </div>
  )
}

function MyAccessPanel() {
  const { baseRole, role, scopeRoles, globalCapabilities } = useCapabilities()
  const catalog = useCapabilityCatalog()
  const { admin } = useSession()
  const environments = useEnvironmentMap()
  // Para nombrar los permisos: `environments.read` y `servers.read` los tienen los tres roles.
  const servers = useServerOptions()

  const effectiveBase = baseRole ?? role
  if (!admin) return null
  if (!effectiveBase) {
    return (
      <p className="text-sm text-muted-foreground">
        Este backend no publica tu rol, así que no se puede mostrar qué incluye tu acceso.
      </p>
    )
  }

  const grants: EffectiveAccessGrant[] = scopeRoles.map((grant) => {
    const name =
      grant.scope_type === 'environment'
        ? environments.byId.get(grant.scope_id)?.name
        : servers.data?.find((server) => server.id === grant.scope_id)?.name
    const kind = grant.scope_type === 'environment' ? 'Entorno' : 'Servidor'
    return {
      scopeType: grant.scope_type,
      scopeId: grant.scope_id,
      role: grant.role,
      targetLabel: name ?? `${kind} #${grant.scope_id}`,
    }
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Mi acceso</h2>
      <EffectiveAccessPanel
        mode="self"
        baseRole={effectiveBase}
        globalCapabilities={globalCapabilities}
        grants={grants}
        catalog={catalog.data}
        isLoading={catalog.isLoading || (admin.catalog_version != null && catalog.isPending)}
      />
      {/* La matriz es `self.read`: cualquiera puede ver qué otorga cada rol antes de pedir uno. */}
      <Link to={ROLES_MATRIX_PATH} className="text-sm font-medium text-primary hover:underline">
        Ver qué otorga cada rol
      </Link>
    </section>
  )
}
