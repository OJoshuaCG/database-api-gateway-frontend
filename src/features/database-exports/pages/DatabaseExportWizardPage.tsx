import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, ErrorState, PageHeader, Spinner } from '@/components/ui'
import { useServer } from '@/features/servers/hooks/use-servers'
import { ConfirmStep } from '../wizard/steps/ConfirmStep'
import { MonitorStep } from '../wizard/steps/MonitorStep'
import { ObjectsStep } from '../wizard/steps/ObjectsStep'
import { OptionsStep } from '../wizard/steps/OptionsStep'
import { OriginStep } from '../wizard/steps/OriginStep'
import { WizardNav } from '../wizard/WizardNav'
import { WizardStepper } from '../wizard/WizardStepper'
import { useDatabaseExportWizard } from '../wizard/use-database-export-wizard'

/**
 * Asistente "Exportar base de datos": origen y formato → qué exportar → opciones → confirmar →
 * ejecución asíncrona con monitor por polling.
 *
 * Ruta full-page y no un tab de la ficha de la base, por el mismo motivo que
 * `collation-conversions`: una exportación puede tardar horas (el tope del backend son cuatro) y el
 * job tiene que sobrevivir a la navegación.
 *
 * La identidad de la base viaja por query string (`?serverId=&database=`) porque **el formulario
 * entero se deriva de las capacidades de ESA base**: sin servidor y sin nombre no hay nada que
 * pintar, ni siquiera un selector. `?jobId=` habilita la reentrada directa al monitor, que es lo que
 * hace que recargar la página en mitad de una exportación no pierda el job.
 */
export function DatabaseExportWizardPage() {
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
          Esta pantalla necesita el servidor y el nombre de la base en la URL
          (`?serverId=&database=`). Volvé a entrar desde la ficha de la base de datos.
        </p>
      </div>
    )
  }

  return (
    <DatabaseExportWizardContent
      // React Router no remonta al cambiar el query string, así que la `key` fuerza un asistente
      // limpio: reutilizar el estado entre dos bases distintas mezclaría selecciones y specs.
      key={`${serverId}-${database}-${jobIdRaw ?? 'blank'}`}
      serverId={serverId}
      database={database}
      jobIdRaw={jobIdRaw}
    />
  )
}

function DatabaseExportWizardContent({
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

  const parsedJobId = jobIdRaw ? Number(jobIdRaw) : undefined
  const presetJobId =
    parsedJobId !== undefined && Number.isFinite(parsedJobId) && parsedJobId > 0
      ? parsedJobId
      : undefined

  return (
    <DatabaseExportWizardBody
      serverId={serverId}
      serverName={server.data.name}
      database={database}
      presetJobId={presetJobId}
      onClose={() => navigate(`/servers/${serverId}/databases/${encodeURIComponent(database)}`)}
    />
  )
}

function DatabaseExportWizardBody({
  serverId,
  serverName,
  database,
  presetJobId,
  onClose,
}: {
  serverId: number
  serverName: string
  database: string
  presetJobId?: number
  onClose: () => void
}) {
  const wizard = useDatabaseExportWizard({ serverId, database, presetJobId })

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h)-3rem)] flex-col gap-6">
      <PageHeader
        title="Exportar base de datos"
        description={`Volcado de «${database}» en ${serverName}: estructura, datos o ambos.`}
        actions={
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        }
      />

      {/* El monitor no muestra el stepper: desde ahí no se vuelve atrás, el plan ya se consumió. */}
      {wizard.step !== 'monitor' && <WizardStepper wizard={wizard} />}

      <Card>
        <CardContent>
          {wizard.step === 'origin' && <OriginStep wizard={wizard} />}
          {wizard.step === 'objects' && <ObjectsStep wizard={wizard} />}
          {wizard.step === 'options' && <OptionsStep wizard={wizard} />}
          {wizard.step === 'confirm' && <ConfirmStep wizard={wizard} />}
          {wizard.step === 'monitor' && <MonitorStep wizard={wizard} />}
        </CardContent>
      </Card>

      <WizardNav wizard={wizard} />
    </div>
  )
}
