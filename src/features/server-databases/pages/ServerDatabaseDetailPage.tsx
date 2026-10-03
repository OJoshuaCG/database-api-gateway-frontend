import { type ReactNode, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AdoptionBadge,
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  EmptyState,
  EnvironmentBadge,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  TabButton,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { EngineType, ManagedDatabaseOut } from '@/lib/contracts'
import { serverUserPath } from '@/lib/routes'
import { useServer } from '@/features/servers/hooks/use-servers'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'
import { resolveEnvironmentState, useEnvironmentMap } from '@/features/environments'
import { ManagedDatabaseMigrationsContent } from '@/features/managed-databases/components/ManagedDatabaseMigrationsContent'
import { AgentAccessBadge } from '@/features/managed-databases/components/AgentAccessBadge'
import { ProvisionStatusBadge } from '@/features/managed-databases/components/ProvisionStatusBadge'
import {
  DatabaseActionDialogs,
  DatabaseHeaderActions,
  type DatabaseActionTarget,
  type PendingDatabaseAction,
} from '@/features/managed-databases/components/DatabaseRowActions'
import { resolveDatabaseState } from '@/features/managed-databases/database-actions'
import { useServerDatabases } from '../hooks/use-server-databases'
import { engineLabel } from '../logic'
import { DatabaseGranteesPanel } from '../components/DatabaseGranteesPanel'

const TABS = ['grantees', 'summary', 'migrations', 'collation'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/**
 * Ficha unificada de una base de datos física del servidor: usuarios con permisos, resumen,
 * migraciones (si está adoptada) y el atajo a convertir su collation, junto con su cruce con el
 * inventario del gateway.
 *
 * Su identidad es `(server_id, nombre)` y ambos vienen de la URL, así que la página carga por su
 * cuenta el servidor (motor y endpoint) y el listado cruzado, en vez de recibirlos por props: es
 * lo que permite entrar aquí directamente desde un enlace o un recargado de página.
 *
 * Migraciones/comparar esquema/clonar dependen del `id` numérico de `ManagedDatabaseOut`: son
 * operaciones de inventario (blueprint, historial, provisión) que no existen para una BD física
 * sin adoptar. Por eso se condicionan a `managed !== null` y, sin adoptar, ofrecen el CTA
 * «Adoptar» en vez de ocultarse del todo.
 *
 * **La cabecera tiene TODAS las acciones de la base (R1)**: es `DatabaseHeaderActions`, la misma
 * fuente que las filas de los listados, así que una acción que aparece en una fila no puede faltar
 * aquí. Ver `features/managed-databases/database-actions.ts`.
 *
 * La base puede estar en el inventario y NO en el motor. Eso no es «ya no existe»: si su registro
 * está en `pending`/`error` todavía no se creó (y se ofrece Aprovisionar); si estaba activa,
 * existió y desapareció por fuera del gateway (y se ofrece Recrear). Solo cuando no está en
 * ningún plano la ficha dice que no existe.
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

  const [pendingAction, setPendingAction] = useState<PendingDatabaseAction | null>(null)

  const validParams = Number.isFinite(serverId) && database !== undefined
  const server = useServer(serverId)
  const { rows, physical, inventory, inventoryTruncated, refetch } = useServerDatabases(
    serverId,
    validParams,
  )
  // Datos del resumen: consultas ya cacheadas por los selects del inventario, que degradan solas
  // (si no resuelven, el resumen muestra el id crudo en vez del nombre).
  const owners = useServerUserOptions(validParams ? serverId : null)
  const models = useDatabaseModelOptions()
  const environmentMap = useEnvironmentMap()

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
  // Fuera del motor todavía puede estar en el inventario: sin aprovisionar, o desaparecida.
  const registered = row
    ? null
    : (inventory.data?.items.find((candidate) => candidate.name === database) ?? null)

  // Sin el inventario no se puede distinguir «todavía no existe» de «no existe»: se espera.
  if (!row && inventory.isPending) return <FullPageSpinner label="Cargando inventario" />

  // Caso real, no defensivo: pueden haberla borrado desde otra pestaña o por fuera del gateway.
  // Es terminal —no hay nada que reintentar— así que la única salida es volver al listado.
  if (!row && !registered) {
    return (
      <div className="flex flex-col gap-6">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
        <EmptyState
          title="Esta base de datos no existe en el servidor."
          description={
            `«${database}» no aparece en el listado del motor ni en el inventario del gateway. ` +
            'Puede haberse eliminado desde otra pestaña o fuera del gateway.' +
            (inventory.isError || inventoryTruncated
              ? ' (El inventario no se cargó completo: si estaba registrada, buscala en «Bases de datos».)'
              : '')
          }
          action={
            <Link to={backTo}>
              <Button variant="outline">Volver a las bases de datos</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const managed = row ? row.managed : registered
  const target: DatabaseActionTarget = {
    serverId,
    name: database,
    managed,
    state: resolveDatabaseState({
      managed,
      // Truncado cuenta como desconocido: fuera de la primera página una base adoptada saldría
      // «no gestionada» y se ofrecería adoptarla otra vez.
      inventoryKnown: inventory.isSuccess && !inventoryTruncated,
      presence: row ? 'present' : 'absent',
    }),
  }
  const ownerOf = (db: ManagedDatabaseOut) =>
    owners.data?.find((user) => user.id === db.owner_id) ?? null
  const modelNameOf = (db: ManagedDatabaseOut) =>
    db.model_id == null
      ? null
      : (models.data?.find((model) => model.id === db.model_id)?.name ?? `#${db.model_id}`)

  const environment = managed ? (
    <EnvironmentBadge state={resolveEnvironmentState(managed.environment_id, environmentMap)} />
  ) : null

  const summary = (
    <SummaryCard
      name={database}
      serverId={serverId}
      engine={server.data.engine}
      managed={managed}
      owner={managed ? ownerOf(managed) : null}
      modelName={managed ? modelNameOf(managed) : null}
      environment={environment}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
        <PageHeader
          title={database}
          description={`${server.data.name} · ${server.data.host}:${server.data.port} · ${engineLabel(server.data.engine)}`}
          actions={<DatabaseHeaderActions target={target} onAction={setPendingAction} />}
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* Mientras el inventario no haya resuelto, el cruce es indeterminado: decir
              "No adoptada" sería afirmar algo que todavía no se sabe. */}
          {inventory.isPending ? (
            <Badge tone="neutral">Inventario…</Badge>
          ) : managed ? (
            <>
              <AdoptionBadge status="adopted" />
              <ProvisionStatusBadge status={managed.status} />
              {/* Junto a las acciones y no solo en «Resumen», que no es la pestaña por defecto:
                  es la etiqueta que dice «producción» al lado del «Eliminar del motor 🔌». */}
              {environment}
              {/* Estado de agentes junto a las acciones: «Acceso de agentes» está en la cabecera
                  (R1) y el operador tiene que ver el resultado sin abrir el diálogo. */}
              <AgentAccessBadge database={managed} />
            </>
          ) : (
            <AdoptionBadge status="unmanaged" />
          )}
          {/* Sin adoptar, las acciones de inventario no se pintan: en vez de botones
              deshabilitados con un `title` (invisible en táctil), el motivo queda escrito. */}
          {target.state === 'unmanaged' && (
            <p className="text-xs text-muted-foreground">
              Editar, reasignar el propietario, quitar del inventario, comparar esquema, clonar y
              migraciones se habilitan tras adoptar esta base de datos.
            </p>
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
      {!managed && inventoryTruncated && (
        <p className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          El inventario de este servidor tiene más registros de los que se cargaron: esta base
          podría estar adoptada y figurar aquí como «No adoptada». Por eso no se ofrece «Adoptar» ni
          sus acciones de inventario.
        </p>
      )}

      {row ? (
        <>
          <div className="flex gap-1 border-b border-border" role="tablist">
            <TabButton active={tab === 'grantees'} onClick={() => setTab('grantees')}>
              Usuarios con permisos
            </TabButton>
            <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
              Resumen
            </TabButton>
            <TabButton active={tab === 'migrations'} onClick={() => setTab('migrations')}>
              Migraciones
            </TabButton>
            <TabButton active={tab === 'collation'} onClick={() => setTab('collation')}>
              Collation
            </TabButton>
          </div>

          {tab === 'grantees' && <DatabaseGranteesPanel serverId={serverId} database={row.name} />}

          {/* «Exportar» y «Convertir collation» ya no se repiten aquí: el primero está en la
              cabecera con el resto de acciones, el segundo tiene su pestaña. */}
          {tab === 'summary' && summary}

          {tab === 'migrations' &&
            (managed !== null ? (
              <ManagedDatabaseMigrationsContent databaseId={managed.id} embedded />
            ) : (
              <EmptyState
                title="Esta base de datos no está adoptada"
                description="Las migraciones son una operación de inventario: adoptá primero esta base para gestionar su blueprint y versiones."
                action={
                  target.state === 'unmanaged' ? (
                    <Button
                      onClick={() =>
                        setPendingAction({ action: 'adopt', target, surface: 'detail' })
                      }
                    >
                      Adoptar esta base para gestionar sus migraciones
                    </Button>
                  ) : undefined
                }
              />
            ))}

          {/*
            La pestaña «Collation» no embebe el asistente: es una ruta full-page a propósito (un job
            puede tardar horas y debe sobrevivir a la navegación, ver el comentario en
            `CollationConversionWizardPage`) y solo lee `serverId`/`database` de su propia query
            string, no de props. Embeberla aquí duplicaría su layout y perdería esos parámetros
            porque esta página los lleva en el path, no en `?serverId=&database=`.
          */}
          {tab === 'collation' && (
            <Card>
              <CardContent className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  Re-alinea el charset y la collation de «{row.name}» hacia un valor único con el
                  asistente dedicado (previsualización, confirmación y monitor de un job que puede
                  tardar horas).
                </p>
                <Button
                  onClick={() =>
                    navigate(
                      `/collation-conversions?serverId=${serverId}&database=${encodeURIComponent(row.name)}`,
                    )
                  }
                >
                  Convertir collation 🔌
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        // Registrada pero fuera del motor: sin pestañas, porque grantees, migraciones y collation
        // hablan con una base que no está. Queda qué pasó, su salida y el registro.
        <>
          {target.state === 'managed-unprovisioned' ? (
            <Callout tone="info" title="Todavía no existe en el motor">
              <p>
                «{database}» está registrada en el inventario pero nunca se creó en{' '}
                {server.data.name}
                {managed?.status === 'error' ? ' (el intento de crearla falló)' : ''}. Aprovisionala
                para ejecutar el CREATE DATABASE; hasta entonces no hay usuarios con permisos,
                migraciones ni collation que mostrar.
              </p>
            </Callout>
          ) : target.state === 'managed-archived-unlisted' ? (
            <Callout tone="info" title="Archivada y fuera del motor">
              <p>
                «{database}» está archivada en el inventario y no aparece en el listado de{' '}
                {server.data.name}. Una base archivada no se recrea: podés editar su registro o
                quitarla del inventario.
              </p>
            </Callout>
          ) : (
            <Callout tone="warning" title="Ya no aparece en el motor">
              <p>
                El inventario registra «{database}» como existente, pero no está en el listado de{' '}
                {server.data.name}: se eliminó por fuera del gateway o desde otra pestaña. Podés
                recrearla vacía o quitarla del inventario.
              </p>
            </Callout>
          )}
          {summary}
        </>
      )}

      <DatabaseActionDialogs
        pending={pendingAction}
        getServer={(id) => (id === serverId ? server.data : undefined)}
        onClose={() => setPendingAction(null)}
        // El recurso que esta página muestra dejó de existir (o su existencia quedó en duda), así
        // que no hay a dónde volver dentro de ella: se sale al listado, que es donde se comprueba
        // el estado real. `replace` evita que «atrás» devuelva a una ficha muerta.
        //
        // No se pasa `onShowGrantees`: los grantees son una pestaña de ESTA página, y salir del
        // diálogo para verlos quemaría el `confirm_token` y consumiría cuota del preview.
        onDropped={() => {
          refetch()
          void navigate(backTo, { replace: true })
        }}
      />
    </div>
  )
}

/** Pestaña «Resumen»: la base en el motor y, si está registrada, su ficha de inventario. */
function SummaryCard({
  name,
  serverId,
  engine,
  managed,
  owner,
  modelName,
  environment,
}: {
  name: string
  serverId: number
  engine: EngineType
  managed: ManagedDatabaseOut | null
  owner: { username: string; host?: string | null } | null
  modelName: string | null
  environment: ReactNode
}) {
  return (
    <Card>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label="Nombre">
            <span className="font-mono text-xs">{name}</span>
          </Fact>
          <Fact label="Motor">{engineLabel(engine)}</Fact>
          <Fact label="Inventario">{managed ? 'Registrada en el gateway' : 'No registrada'}</Fact>
          {managed ? (
            <>
              <Fact label="Estado">
                <ProvisionStatusBadge status={managed.status} />
              </Fact>
              <Fact label="Propietario">
                {owner ? (
                  <Link
                    to={serverUserPath(serverId, owner.username, owner.host)}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {owner.host ? `${owner.username}@${owner.host}` : owner.username}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">#{managed.owner_id}</span>
                )}
              </Fact>
              <Fact label="Entorno">{environment}</Fact>
              <Fact label="Blueprint">
                {managed.model_id != null ? (
                  <Link
                    to={`/database-models/${managed.model_id}/migrations`}
                    className="text-primary hover:underline"
                  >
                    {modelName}
                  </Link>
                ) : (
                  'Sin blueprint'
                )}
              </Fact>
              <Fact label="Versión">
                <span className="font-mono text-xs">{managed.model_version ?? '—'}</span>
              </Fact>
              <Fact label="Id del registro">#{managed.id}</Fact>
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
