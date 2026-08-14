import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { useServer } from '@/features/servers/hooks/use-servers'
import { useServerDatabases } from '../hooks/use-server-databases'
import { engineLabel } from '../logic'
import { DatabaseGranteesPanel } from '../components/DatabaseGranteesPanel'
import { DropDatabaseDialog } from '../components/DropDatabaseDialog'

const TABS = ['grantees', 'summary'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/**
 * Ficha de una base de datos física del servidor: usuarios con permisos y su cruce con el
 * inventario del gateway.
 *
 * Su identidad es `(server_id, nombre)` y ambos vienen de la URL, así que la página carga por su
 * cuenta el servidor (motor y endpoint) y el listado cruzado, en vez de recibirlos por props: es
 * lo que permite entrar aquí directamente desde un enlace o un recargado de página.
 */
export function ServerDatabaseDetailPage() {
  const params = useParams()
  const serverId = Number(params.serverId)
  // React Router ya entrega el segmento decodificado: los nombres legados con «.», «-» o «$»
  // llegan aquí tal cual están en el motor, que es contra lo que hay que comparar.
  const database = params.database
  const navigate = useNavigate()

  // La pestaña vive en la URL (`?tab=`), igual que en `ServerDetailPage`: hace enlazable una
  // pestaña concreta y un valor desconocido cae en `grantees` en vez de dejar la página vacía.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'grantees'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }

  const [dropOpen, setDropOpen] = useState(false)

  const validParams = Number.isFinite(serverId) && database !== undefined
  const server = useServer(serverId)
  const { rows, physical, inventory, refetch } = useServerDatabases(serverId, validParams)

  if (!validParams) {
    return <ErrorState error={new Error('Ruta de base de datos inválida.')} />
  }
  if (server.isLoading) return <FullPageSpinner label="Cargando servidor" />
  if (server.isError || !server.data) {
    return <ErrorState error={server.error} onRetry={() => void server.refetch()} />
  }

  const backTo = `/servers/${serverId}?tab=databases`
  const backLabel = `← Bases de datos de ${server.data.name}`

  if (physical.isLoading) return <FullPageSpinner label="Cargando bases de datos del servidor" />
  // Solo el listado físico es bloqueante: es el que dice si esta base existe.
  if (physical.isError) {
    return <ErrorState error={physical.error} onRetry={() => refetch()} />
  }

  const row = rows.find((candidate) => candidate.name === database) ?? null

  // Caso real, no defensivo: pueden haberla borrado desde otra pestaña o por fuera del gateway.
  // Es terminal —no hay nada que reintentar— así que la única salida es volver al listado.
  if (!row) {
    return (
      <div className="flex flex-col gap-6">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
        <EmptyState
          title="Esta base de datos ya no existe en el servidor."
          description={`«${database}» no aparece en el listado del motor. Puede haberse eliminado desde otra pestaña o fuera del gateway.`}
          action={
            <Link to={backTo}>
              <Button variant="outline">Volver a las bases de datos</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const managed = row.managed

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
        <PageHeader
          title={row.name}
          description={`${server.data.name} · ${server.data.host}:${server.data.port} · ${engineLabel(server.data.engine)}`}
          actions={
            <Button variant="danger" onClick={() => setDropOpen(true)}>
              Eliminar base de datos 🔌
            </Button>
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* Mientras el inventario no haya resuelto, el cruce es indeterminado: decir
              "No gestionada" sería afirmar algo que todavía no se sabe. */}
          {inventory.isPending ? (
            <Badge tone="neutral">Inventario…</Badge>
          ) : row.isManaged ? (
            <>
              <Badge tone="success">Gestionada</Badge>
              <Link
                to="/managed-databases"
                className="text-xs font-medium text-primary hover:underline"
              >
                ver registro →
              </Link>
            </>
          ) : (
            <Badge tone="warning">No gestionada</Badge>
          )}
        </div>
      </div>

      {/* Fallo parcial: los grantees siguen siendo útiles sin el cruce, pero hay que decirlo. */}
      {inventory.isError && (
        <p className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          No se pudo cargar el cruce con el inventario: la insignia y el resumen pueden no ser
          fiables.
        </p>
      )}

      <div className="flex gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === 'grantees'} onClick={() => setTab('grantees')}>
          Usuarios con permisos
        </TabButton>
        <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
          Resumen
        </TabButton>
      </div>

      {tab === 'grantees' && <DatabaseGranteesPanel serverId={serverId} database={row.name} />}

      {tab === 'summary' && (
        <Card>
          <CardContent>
            <div className="mb-4 flex justify-end">
              <Button
                variant="outline"
                onClick={() =>
                  navigate(
                    `/collation-conversions?serverId=${serverId}&database=${encodeURIComponent(row.name)}`,
                  )
                }
              >
                Convertir collation 🔌
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact label="Nombre">
                <span className="font-mono text-xs">{row.name}</span>
              </Fact>
              <Fact label="Motor">{engineLabel(server.data.engine)}</Fact>
              <Fact label="Inventario">
                {row.isManaged ? 'Registrada en el gateway' : 'No registrada'}
              </Fact>
              {managed ? (
                <>
                  <Fact label="Id del registro">#{managed.id}</Fact>
                  <Fact label="Estado">{managed.status}</Fact>
                  <Fact label="Origen">{managed.origin ?? '—'}</Fact>
                  <Fact label="Charset">{managed.charset ?? '—'}</Fact>
                  <Fact label="Collation">{managed.collation ?? '—'}</Fact>
                  <Fact label="Creado">{formatDateTime(managed.created_at)}</Fact>
                  <Fact label="Actualizado">{formatDateTime(managed.updated_at)}</Fact>
                  <div className="sm:col-span-2">
                    <Fact label="Notas">{managed.notes ?? '—'}</Fact>
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <p className="text-sm text-muted-foreground">
                    Esta base no está registrada en el inventario del gateway.
                  </p>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/*
        El borrado sigue siendo modal aunque el detalle ya no lo sea: es una operación
        irreversible en dos pasos y el foco modal es justo su función. Montaje condicional para
        que nazca con estado fresco (token y transcripción del nombre), sin resetear por efectos.

        No se le pasa `onShowGrantees`: los grantees son una pestaña de ESTA página, y salir del
        diálogo para verlos quemaría el `confirm_token` y consumiría cuota del preview.
      */}
      {dropOpen && (
        <DropDatabaseDialog
          serverId={serverId}
          serverName={server.data.name}
          serverEndpoint={`${server.data.host}:${server.data.port}`}
          engine={server.data.engine}
          database={row.name}
          onClose={() => setDropOpen(false)}
          onDeleted={() => {
            // El recurso que esta página muestra dejó de existir (o su existencia quedó en duda),
            // así que no hay a dónde volver dentro de ella: se sale al listado, que es donde se
            // comprueba el estado real. `replace` evita que «atrás» devuelva a una ficha muerta.
            refetch()
            void navigate(backTo, { replace: true })
          }}
        />
      )}
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
          ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
          : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}
