import { useSearchParams } from 'react-router-dom'
import { Card, PageHeader } from '@/components/ui'
import { useCloneBatchWizard } from '../wizard/use-clone-batch-wizard'
import { WizardNav, WizardStepper } from '../wizard/WizardShell'
import { PlanStep } from '../wizard/steps/PlanStep'
import { DatabasesStep } from '../wizard/steps/DatabasesStep'
import { ConfirmStep } from '../wizard/steps/ConfirmStep'
import { MonitorStep } from '../wizard/steps/MonitorStep'

/**
 * Asistente de clonación en LOTE (`/database-clones/lotes`).
 *
 * Reentrada por `?batchId=` para volver al seguimiento de un lote en curso, igual mecanismo
 * que el asistente individual con `?jobId=`. El `key` fuerza el remontaje cuando cambia el
 * lote de la URL: sin eso, el estado del asistente anterior sobreviviría al cambio.
 */
export function CloneBatchWizardPage() {
  const [searchParams] = useSearchParams()
  const raw = searchParams.get('batchId')
  const presetBatchId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined
  return <CloneBatchWizardContent key={presetBatchId ?? 'nuevo'} presetBatchId={presetBatchId} />
}

function CloneBatchWizardContent({ presetBatchId }: { presetBatchId?: number }) {
  const wizard = useCloneBatchWizard(presetBatchId)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clonar varias bases"
        description="Copia N bases de datos de un servidor a otro con una sola confirmación."
      />
      <WizardStepper wizard={wizard} />
      <Card>
        {wizard.step === 'plan' && <PlanStep wizard={wizard} />}
        {wizard.step === 'databases' && <DatabasesStep wizard={wizard} />}
        {wizard.step === 'confirm' && <ConfirmStep wizard={wizard} />}
        {wizard.step === 'monitor' && <MonitorStep wizard={wizard} />}
      </Card>
      <WizardNav wizard={wizard} />
    </div>
  )
}
