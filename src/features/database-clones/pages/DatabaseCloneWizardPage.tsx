import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, PageHeader } from '@/components/ui'
import { MonitorStep } from '../wizard/steps/MonitorStep'
import { PlanStep } from '../wizard/steps/PlanStep'
import { PreviewStep } from '../wizard/steps/PreviewStep'
import { SelectionStep } from '../wizard/steps/SelectionStep'
import { SummaryStep } from '../wizard/steps/SummaryStep'
import { WizardNav } from '../wizard/WizardNav'
import { WizardStepper } from '../wizard/WizardStepper'
import { useDatabaseCloneWizard } from '../wizard/use-database-clone-wizard'

/**
 * Asistente "Clonar base de datos": plan (origen/destino/opciones) → [selección parcial] →
 * preview + confirmación → ejecución asíncrona con monitor por polling. Ruta full-page con pasos
 * internos, admite reentrada con `?jobId=` desde un link directo a un plan existente.
 */
export function DatabaseCloneWizardPage() {
  const [params] = useSearchParams()
  const routeParams = useParams()
  // El id de la operación vive en la RUTA (`/database-clones/:jobId`). `?jobId=` se sigue
  // aceptando porque es el único link que alguien pudo haberse guardado.
  const presetJobIdRaw = routeParams.jobId ?? params.get('jobId')
  const presetSourceIdRaw = params.get('sourceDatabaseId')

  // La `key` fuerza un asistente en blanco cada vez que cambia el prellenado: React Router no
  // remonta el elemento solo porque cambie el query string, y con el id en la ruta tampoco lo
  // remonta al pasar de un job a otro dentro de la misma ruta paramétrica.
  return (
    <DatabaseCloneWizardContent
      key={presetJobIdRaw ?? presetSourceIdRaw ?? 'blank'}
      presetJobIdRaw={presetJobIdRaw}
      presetSourceIdRaw={presetSourceIdRaw}
    />
  )
}

function DatabaseCloneWizardContent({
  presetJobIdRaw,
  presetSourceIdRaw,
}: {
  presetJobIdRaw: string | null
  presetSourceIdRaw: string | null
}) {
  const navigate = useNavigate()

  const presetJobId = presetJobIdRaw ? Number(presetJobIdRaw) : undefined
  const presetSourceDatabaseId = presetSourceIdRaw ? Number(presetSourceIdRaw) : undefined

  const wizard = useDatabaseCloneWizard({
    presetJobId:
      presetJobId !== undefined && Number.isFinite(presetJobId) ? presetJobId : undefined,
    presetSourceDatabaseId:
      presetSourceDatabaseId !== undefined && Number.isFinite(presetSourceDatabaseId)
        ? presetSourceDatabaseId
        : undefined,
    // Al encolar, la operación pasa a tener dirección propia: se puede recargar, cerrar la
    // pestaña y volver mañana desde el historial cayendo en el mismo lugar. `replace` para que
    // el botón Atrás no devuelva a un asistente cuyo plan ya se ejecutó.
    onExecuted: (jobId) => navigate(`/database-clones/${jobId}`, { replace: true }),
  })

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h)-3rem)] flex-col gap-6">
      <PageHeader
        title={presetJobId != null ? `Clonación #${presetJobId}` : 'Clonar base de datos'}
        description={
          presetJobId != null
            ? 'Seguimiento de la operación. Esta dirección es estable: podés volver cuando quieras.'
            : 'Copia estructura y, opcionalmente, todos los datos a cualquier servidor.'
        }
        actions={
          <Button variant="ghost" onClick={() => navigate('/database-clones')}>
            {presetJobId != null ? 'Volver al historial' : 'Cancelar'}
          </Button>
        }
      />

      {wizard.step !== 'summary' && wizard.step !== 'monitor' && <WizardStepper wizard={wizard} />}

      <Card>
        <CardContent>
          {wizard.step === 'summary' && <SummaryStep wizard={wizard} />}
          {wizard.step === 'plan' && <PlanStep wizard={wizard} />}
          {wizard.step === 'selection' && <SelectionStep wizard={wizard} />}
          {wizard.step === 'preview' && <PreviewStep wizard={wizard} />}
          {wizard.step === 'monitor' && <MonitorStep wizard={wizard} />}
        </CardContent>
      </Card>

      <WizardNav wizard={wizard} />
    </div>
  )
}
