import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Button,
  Card,
  CardContent,
  Combobox,
  ErrorState,
  PageHeader,
  Spinner,
} from '@/components/ui'
import { PAGINATION, type ServerOut } from '@/lib/contracts'
import { useServer, useServers } from '@/features/servers/hooks/use-servers'
import { useServerDatabases } from '@/features/server-databases/hooks/use-server-databases'
import { MonitorStep } from '../wizard/steps/MonitorStep'
import { PlanStep } from '../wizard/steps/PlanStep'
import { PreviewStep } from '../wizard/steps/PreviewStep'
import { SummaryStep } from '../wizard/steps/SummaryStep'
import { InventoryStep } from '../wizard/steps/InventoryStep'
import { WizardNav } from '../wizard/WizardNav'
import { WizardStepper } from '../wizard/WizardStepper'
import { useCollationConversionWizard } from '../wizard/use-collation-conversion-wizard'

/**
 * Asistente "Convertir collation": objetivo → inventario/selección → preview + confirmación →
 * ejecución asíncrona con monitor por polling. Ruta full-page (no un tab embebido en la ficha de
 * la BD, ver §2 del plan): un job puede correr horas y debe sobrevivir a la navegación.
 *
 * Identidad de la base (`serverId`+`database`) viaja por query string, igual que
 * `?sourceDatabaseId=` en `database-clones`; `?jobId=` habilita la reentrada a un plan existente.
 * El motor (`engine`) NO viaja en la URL: se resuelve acá con `useServer`, la misma fuente que ya
 * usa `ServerDatabaseDetailPage` — evita duplicar ese dato en el link.
 */
export function CollationConversionWizardPage() {
  const [params] = useSearchParams()
  const serverIdRaw = params.get('serverId')
  const database = params.get('database')
  const jobIdRaw = params.get('jobId')

  const serverId = serverIdRaw ? Number(serverIdRaw) : NaN

  if (!Number.isFinite(serverId) || serverId <= 0 || !database) {
    return <CollationConversionEntryPicker />
  }

  return (
    <CollationConversionWizardContent
      key={`${serverId}-${database}-${jobIdRaw ?? 'blank'}`}
      serverId={serverId}
      database={database}
      jobIdRaw={jobIdRaw}
    />
  )
}

/**
 * Se muestra cuando se entra a `/collation-conversions` sin `?serverId=&database=` (p. ej. desde
 * el sidebar, en vez del atajo de `ServerDatabaseDetailPage`). Deja elegir servidor y base acá
 * mismo, y navega con el mismo formato de URL que ese atajo en vez de duplicar el wizard.
 */
function CollationConversionEntryPicker() {
  const navigate = useNavigate()
  const [server, setServer] = useState<ServerOut | null>(null)
  const [database, setDatabase] = useState<string | null>(null)

  const servers = useServers({ page: 1, size: PAGINATION.maxSize })
  const { rows } = useServerDatabases(server?.id ?? 0, server !== null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Convertir collation"
        description="Elegí el servidor y la base de datos a las que querés cambiarles el charset y la collation."
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Combobox<ServerOut>
            items={servers.data?.items ?? []}
            itemToKey={(item) => item.id}
            itemToString={(item) => `${item.name} (${item.host}:${item.port})`}
            value={server}
            onChange={(item) => {
              setServer(item)
              setDatabase(null)
            }}
            label="Servidor"
            placeholder="Elegí un servidor…"
            isLoading={servers.isLoading}
            clearable
          />
          <Combobox<string>
            items={rows.map((row) => row.name)}
            itemToKey={(name) => name}
            itemToString={(name) => name}
            value={database}
            onChange={setDatabase}
            label="Base de datos"
            placeholder={server ? 'Elegí una base de datos…' : 'Elegí primero un servidor'}
            disabled={server === null}
            clearable
          />
          <div className="flex justify-end">
            <Button
              disabled={server === null || database === null}
              onClick={() =>
                server &&
                database &&
                navigate(
                  `/collation-conversions?serverId=${server.id}&database=${encodeURIComponent(database)}`,
                )
              }
            >
              Continuar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CollationConversionWizardContent({
  serverId,
  database,
  jobIdRaw,
}: {
  serverId: number
  database: string
  jobIdRaw: string | null
}) {
  const navigate = useNavigate()
  const server = useServer(serverId)

  if (server.isLoading && !server.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Spinner /> Cargando el servidor…
      </div>
    )
  }
  if (server.isError || !server.data) {
    return <ErrorState error={server.error} onRetry={() => void server.refetch()} />
  }

  const presetJobId = jobIdRaw ? Number(jobIdRaw) : undefined

  return (
    <CollationConversionWizardBody
      serverId={serverId}
      serverName={server.data.name}
      database={database}
      engine={server.data.engine}
      presetJobId={
        presetJobId !== undefined && Number.isFinite(presetJobId) ? presetJobId : undefined
      }
      onCancel={() => navigate(`/servers/${serverId}/databases/${encodeURIComponent(database)}`)}
    />
  )
}

function CollationConversionWizardBody({
  serverId,
  serverName,
  database,
  engine,
  presetJobId,
  onCancel,
}: {
  serverId: number
  serverName: string
  database: string
  engine: Parameters<typeof useCollationConversionWizard>[0]['engine']
  presetJobId?: number
  onCancel: () => void
}) {
  const wizard = useCollationConversionWizard({
    serverId,
    serverName,
    database,
    engine,
    presetJobId,
  })

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h)-3rem)] flex-col gap-6">
      <PageHeader
        title="Convertir collation"
        description={`Re-alinea el charset y la collation de «${database}» hacia un valor único.`}
        actions={
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        }
      />

      {wizard.step !== 'summary' && wizard.step !== 'monitor' && <WizardStepper wizard={wizard} />}

      <Card>
        <CardContent>
          {wizard.step === 'summary' && <SummaryStep wizard={wizard} />}
          {wizard.step === 'plan' && <PlanStep wizard={wizard} />}
          {wizard.step === 'inventory' && <InventoryStep wizard={wizard} />}
          {wizard.step === 'preview' && <PreviewStep wizard={wizard} />}
          {wizard.step === 'monitor' && <MonitorStep wizard={wizard} />}
        </CardContent>
      </Card>

      <WizardNav wizard={wizard} />
    </div>
  )
}
