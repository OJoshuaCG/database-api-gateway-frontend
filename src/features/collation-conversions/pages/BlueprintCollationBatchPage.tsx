import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, TabButton } from '@/components/ui'
import { useCapabilityGuard, useStepUp } from '@/features/auth'
import { useDatabaseModel } from '@/features/database-models/hooks/use-database-models'
import {
  CAPABILITIES,
  CAPABILITY_ESCALATIONS,
  type CollationBatchCreate,
  type CollationBatchExecuteIn,
  type CollationBatchPlanOut,
  type CollationBlueprintVersionOut,
} from '@/lib/contracts'
import { BatchConfirmStep } from '../batch/BatchConfirmStep'
import { BatchMonitorStep } from '../batch/BatchMonitorStep'
import { BatchPlanStep } from '../batch/BatchPlanStep'
import { BlueprintVersionCard } from '../batch/BlueprintVersionCard'
import { CollationDriftPanel } from '../components/CollationDriftPanel'
import {
  useCancelCollationBatch,
  useCollationBatch,
  useCreateCollationBlueprintVersion,
  useExecuteCollationBatch,
  usePlanCollationBatch,
} from '../hooks/use-collation-batches'

/**
 * Conversión de collation de TODAS las bases de un blueprint, en un gesto.
 *
 * Tres pasos —planificar, confirmar, seguir— más un panel de deriva que responde la pregunta
 * previa: ¿hace falta convertir algo?
 *
 * **La reentrada por `?batchId=` va directo al monitor**, igual que el asistente por base. Y hay
 * un caso que conviene entender antes de tocarlo: si se recarga la página con un lote todavía
 * `pending` (planificado pero nunca ejecutado), el `batch_token` se perdió con el estado de React
 * y no se puede confirmar. Eso no es un bug que haya que tapar guardando el token: el token es
 * frescura, y uno recuperado de `sessionStorage` después de una recarga ya no la aporta. El
 * monitor muestra ese estado y ofrece planificar de nuevo, que es la salida honesta.
 */
export function BlueprintCollationBatchPage() {
  const { modelId: modelIdParam } = useParams<{ modelId: string }>()
  const modelId = Number(modelIdParam)

  const [searchParams, setSearchParams] = useSearchParams()
  const batchIdFromUrl = Number(searchParams.get('batchId')) || 0

  // Se lee el blueprint solo para NOMBRARLO. No es cosmético: esta pantalla convierte todas las
  // bases de un blueprint de una vez, y equivocarse de blueprint es el error más caro que se puede
  // cometer acá. Que el nombre esté a la vista desde antes de planificar es la barrera más barata.
  const model = useDatabaseModel(modelId)
  const modelSlug = model.data?.slug ?? null

  const [tab, setTab] = useState<'batch' | 'drift'>('batch')
  /** El plan vive en memoria: es lo que aporta el `batch_token` y el conjunto a echar de vuelta. */
  const [plan, setPlan] = useState<CollationBatchPlanOut | null>(null)
  const [versionResult, setVersionResult] = useState<CollationBlueprintVersionOut | null>(null)

  const batchId = batchIdFromUrl || plan?.batch_id || 0
  /** Se pasó a confirmar y no volvió: hay plan en memoria y todavía no se ejecutó. */
  const [executed, setExecuted] = useState(false)

  const planMutation = usePlanCollationBatch(modelId)
  const stepUp = useStepUp()
  // Registrar el lote como versión crea la versión (`blueprints.write`) y la STAMPEA en cada
  // base del blueprint (`blueprints.apply`), además de `collation.execute` (v23 §4).
  const versionGuard = useCapabilityGuard(
    [CAPABILITIES.collationExecute, ...CAPABILITY_ESCALATIONS.collationBlueprintVersion],
    'registrar el lote como versión del blueprint',
  )
  // Planificar, ejecutar y cancelar el lote: `collation.execute` (`collation_batches.py`).
  const executeGuard = useCapabilityGuard(CAPABILITIES.collationExecute, 'convertir el collation')
  const cancelGuard = useCapabilityGuard(CAPABILITIES.collationExecute, 'cancelar el lote')
  const executeMutation = useExecuteCollationBatch(modelId, batchId)
  const cancelMutation = useCancelCollationBatch(modelId, batchId)
  const versionMutation = useCreateCollationBlueprintVersion(modelId, batchId)

  // El polling solo se enciende cuando hay lote que seguir: en el paso de planificación no hay
  // ninguno, y en el de confirmación el lote existe pero está `pending` sin nada que informar.
  const monitoring = batchId > 0 && (executed || batchIdFromUrl > 0)
  const batch = useCollationBatch(modelId, batchId, monitoring)

  const goToBatch = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('batchId', String(id))
    setSearchParams(next, { replace: true })
  }

  const resetToPlan = () => {
    setPlan(null)
    setExecuted(false)
    setVersionResult(null)
    planMutation.reset()
    executeMutation.reset()
    versionMutation.reset()
    const next = new URLSearchParams(searchParams)
    next.delete('batchId')
    setSearchParams(next, { replace: true })
  }

  // El plan emite el `batch_token` del execute: si a la ventana de step-up le queda poco, la
  // contraseña se pide ANTES, no en el execute con el token corriendo. Cancelar no bloquea el plan.
  const handlePlan = (body: CollationBatchCreate) => {
    const send = () =>
      planMutation.mutate(body, {
        onSuccess: (data) => {
          setPlan(data)
          setExecuted(false)
        },
      })
    stepUp.withFresh(CAPABILITIES.collationExecute, send, send)
  }

  const handleExecute = (body: CollationBatchExecuteIn) => {
    executeMutation.mutate(body, {
      onSuccess: (data) => {
        setExecuted(true)
        goToBatch(data.batch_id)
      },
    })
  }

  if (!Number.isFinite(modelId) || modelId <= 0) {
    return <PageHeader title="Conversión de collation" description="Blueprint no válido." />
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Vuelta a la página del blueprint, que es la vista propia de la entidad (regla R1) y la
          que tiene la entrada a este lote. Sin esto, salir de acá obligaba a ir al catálogo y
          buscarlo otra vez. */}
      <div className="flex flex-col gap-1">
        <Link
          to={`/database-models/${modelId}/migrations`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {model.data ? model.data.name : 'Blueprint'}
        </Link>
        <PageHeader
          title={
            model.data ? `Collation de ${model.data.name}` : 'Conversión de collation del blueprint'
          }
          description="Convierte todas las bases activas del blueprint hacia una misma collation, y deja constancia como versión."
          actions={
            monitoring ? (
              <Button variant="ghost" onClick={resetToPlan}>
                Planificar otro lote
              </Button>
            ) : undefined
          }
        />
      </div>

      <div className="flex gap-2 border-b border-border">
        <TabButton active={tab === 'batch'} onClick={() => setTab('batch')}>
          Lote
        </TabButton>
        <TabButton active={tab === 'drift'} onClick={() => setTab('drift')}>
          Deriva
        </TabButton>
      </div>

      {tab === 'drift' && <CollationDriftPanel modelId={modelId} />}

      {tab === 'batch' && monitoring && (
        <BatchMonitorStep
          data={batch.data}
          isLoading={batch.isLoading}
          error={batch.error}
          isCanceling={cancelMutation.isPending}
          onCancel={() => cancelMutation.mutate()}
          cancelGuard={cancelGuard}
          versionSlot={
            <BlueprintVersionCard
              alreadyCreatedId={batch.data?.batch.blueprint_version_id ?? null}
              isCreating={versionMutation.isPending}
              createError={versionMutation.error}
              result={versionResult}
              onCreate={(name) => versionMutation.mutate({ name }, { onSuccess: setVersionResult })}
              guard={versionGuard}
            />
          }
        />
      )}

      {tab === 'batch' && !monitoring && plan && (
        <BatchConfirmStep
          plan={plan}
          isExecuting={executeMutation.isPending}
          executeError={executeMutation.error}
          onExecute={handleExecute}
          onReplan={resetToPlan}
          guard={executeGuard}
        />
      )}

      {tab === 'batch' && !monitoring && !plan && (
        <BatchPlanStep
          modelSlug={modelSlug}
          isPlanning={planMutation.isPending}
          planError={planMutation.error}
          onPlan={handlePlan}
          guard={executeGuard}
        />
      )}
    </div>
  )
}
