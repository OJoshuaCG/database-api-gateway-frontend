import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '@/components/ui'
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
  const routeParams = useParams()
  // El id vive en la RUTA (`/database-clones/lotes/:batchId`); `?batchId=` se sigue aceptando
  // porque es el único link que alguien pudo haberse guardado.
  const raw = routeParams.batchId ?? searchParams.get('batchId')
  const presetBatchId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined
  return <CloneBatchWizardContent key={presetBatchId ?? 'nuevo'} presetBatchId={presetBatchId} />
}

function CloneBatchWizardContent({ presetBatchId }: { presetBatchId?: number }) {
  const navigate = useNavigate()
  const wizard = useCloneBatchWizard(presetBatchId, (batchId) =>
    navigate(`/database-clones/lotes/${batchId}`, { replace: true }),
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={presetBatchId != null ? `Lote #${presetBatchId}` : 'Clonar varias bases'}
        description={
          presetBatchId != null
            ? 'Seguimiento del lote. Las bases se copian de a una por vez; esta dirección es estable.'
            : 'Copia N bases de datos de un servidor a otro con una sola confirmación.'
        }
        actions={
          <Button variant="ghost" onClick={() => navigate('/database-clones?tab=lotes')}>
            {presetBatchId != null ? 'Volver al historial' : 'Cancelar'}
          </Button>
        }
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
