import { useNavigate, useSearchParams } from 'react-router-dom'
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
  const presetJobIdRaw = params.get('jobId')
  const presetSourceIdRaw = params.get('sourceDatabaseId')

  // Misma ruta con o sin `?jobId=`/`?sourceDatabaseId=` — React Router no remonta el elemento solo
  // porque cambie el query string. La `key` fuerza un asistente en blanco cada vez que cambia el
  // prellenado.
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
    presetJobId: presetJobId !== undefined && Number.isFinite(presetJobId) ? presetJobId : undefined,
    presetSourceDatabaseId:
      presetSourceDatabaseId !== undefined && Number.isFinite(presetSourceDatabaseId)
        ? presetSourceDatabaseId
        : undefined,
  })

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-6">
      <PageHeader
        title="Clonar base de datos"
        description="Copia estructura y, opcionalmente, todos los datos a cualquier servidor."
        actions={
          <Button variant="ghost" onClick={() => navigate('/managed-databases')}>
            Cancelar
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
