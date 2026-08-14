import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, ErrorState, PageHeader, Spinner } from '@/components/ui'
import { useServer } from '@/features/servers/hooks/use-servers'
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
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-error/30 bg-error/5 px-6 py-10 text-center">
        <p className="text-sm font-semibold text-foreground">Falta identificar la base de datos</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Esta pantalla necesita el servidor y el nombre de la base en la URL (`?serverId=&database=`).
          Volvé a entrar desde la ficha de la base de datos.
        </p>
      </div>
    )
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
      presetJobId={presetJobId !== undefined && Number.isFinite(presetJobId) ? presetJobId : undefined}
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
  const wizard = useCollationConversionWizard({ serverId, serverName, database, engine, presetJobId })

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h)-3rem)] flex-col gap-6">
      <PageHeader
        title="Convertir collation"
        description={`Re-alinea el charset y la collation de «${database}» hacia un valor único.`}
        actions={
          <Button variant="ghost" onClick={onCancel}>
            Cerrar
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
