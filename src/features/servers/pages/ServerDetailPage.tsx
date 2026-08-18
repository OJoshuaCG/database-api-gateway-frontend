import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  TabButton,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { useServer } from '../hooks/use-servers'
import { useDeleteServer, useTestConnection } from '../hooks/use-server-mutations'
import { ServerStatusBadge } from '../components/ServerStatusBadge'
import { ServerFormModal } from '../components/ServerFormModal'
import { IntrospectionExplorer } from '../components/IntrospectionExplorer'
import { ServerReconcilePanel } from '../components/ServerReconcilePanel'
import { EngineUsersPanel } from '../components/EngineUsersPanel'
import { ServerDatabasesPanel } from '@/features/server-databases'

const TABS = ['info', 'databases', 'introspection', 'users', 'reconcile'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

export function ServerDetailPage() {
  const params = useParams()
  const serverId = Number(params.serverId)
  const navigate = useNavigate()
  // La pestaña vive en la URL (`?tab=`), no en estado local: es lo que permite enlazar a una
  // pestaña concreta y, sobre todo, que las vistas que salen de aquí puedan VOLVER a la que
  // estaba abierta. Un valor desconocido cae en `info` en vez de dejar la página en blanco.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'info'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data: server, isLoading, isError, error, refetch } = useServer(serverId)
  const testConnection = useTestConnection(serverId)
  const deleteServer = useDeleteServer()

  if (Number.isNaN(serverId)) {
    return <ErrorState error={new Error('Identificador de servidor inválido.')} />
  }
  if (isLoading) return <FullPageSpinner label="Cargando servidor" />
  if (isError || !server) {
    return <ErrorState error={error} onRetry={() => void refetch()} />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/servers" className="text-sm text-muted-foreground hover:text-foreground">
          ← Servidores
        </Link>
        <PageHeader
          title={server.name}
          description={`${server.host}:${server.port} · ${server.engine}`}
          actions={
            <>
              {/* Atajo al sitio donde se comprueba que los permisos que se acaban de tocar
                  hacen lo que se espera, sin tener que volver a elegir el servidor. */}
              <Link to={`/sql-console?server=${server.id}`}>
                <Button variant="outline">Consola SQL</Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => testConnection.mutate()}
                isLoading={testConnection.isPending}
              >
                Probar conexión
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                Editar
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Eliminar
              </Button>
            </>
          }
        />
      </div>

      {testConnection.data && (
        <div
          role="status"
          className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm"
        >
          {testConnection.data.ok ? (
            <span className="text-foreground">
              Conexión exitosa — {testConnection.data.dialect}{' '}
              {testConnection.data.server_version ?? ''}
            </span>
          ) : (
            <span className="text-error">No se pudo conectar al servidor.</span>
          )}
        </div>
      )}

      <div className="flex gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === 'info'} onClick={() => setTab('info')}>
          Información
        </TabButton>
        <TabButton active={tab === 'databases'} onClick={() => setTab('databases')}>
          Bases de datos
        </TabButton>
        <TabButton active={tab === 'introspection'} onClick={() => setTab('introspection')}>
          Introspección
        </TabButton>
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
          Usuarios
        </TabButton>
        <TabButton active={tab === 'reconcile'} onClick={() => setTab('reconcile')}>
          Reconciliación
        </TabButton>
      </div>

      {tab === 'info' && (
        <Card>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact label="Estado">
                <ServerStatusBadge status={server.status} />
              </Fact>
              <Fact label="Activo">{server.is_active ? 'Sí' : 'No'}</Fact>
              <Fact label="Usuario root">{server.root_username}</Fact>
              <Fact label="Contraseña root">
                <Badge tone={server.has_root_password ? 'success' : 'warning'}>
                  {server.has_root_password ? 'Configurada' : 'No configurada'}
                </Badge>
              </Fact>
              <Fact label="Modo TLS">{server.ssl_mode || 'sin TLS'}</Fact>
              <Fact label="Motor">{server.engine}</Fact>
              <Fact label="Creado">{formatDateTime(server.created_at)}</Fact>
              <Fact label="Actualizado">{formatDateTime(server.updated_at)}</Fact>
              {server.notes && (
                <div className="sm:col-span-2">
                  <Fact label="Notas">{server.notes}</Fact>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
      {tab === 'databases' && (
        <ServerDatabasesPanel server={server} onGoToReconcile={() => setTab('reconcile')} />
      )}
      {tab === 'introspection' && <IntrospectionExplorer serverId={serverId} />}
      {tab === 'users' && <EngineUsersPanel serverId={serverId} engine={server.engine} />}
      {tab === 'reconcile' && <ServerReconcilePanel serverId={serverId} />}

      <ServerFormModal open={editOpen} onClose={() => setEditOpen(false)} server={server} />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          deleteServer.mutate(server.id, {
            onSuccess: () => navigate('/servers', { replace: true }),
          })
        }
        title="Eliminar servidor del inventario"
        description={`Se eliminará «${server.name}» del inventario. Los objetos del motor destino no se modifican.`}
        confirmLabel="Eliminar"
        isLoading={deleteServer.isPending}
      />
    </div>
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
