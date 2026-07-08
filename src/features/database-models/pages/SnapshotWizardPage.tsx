import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, PageHeader } from '@/components/ui'
import { OriginStep } from '../snapshot-wizard/steps/OriginStep'
import { PreviewStep } from '../snapshot-wizard/steps/PreviewStep'
import { ObjectsStep } from '../snapshot-wizard/steps/ObjectsStep'
import { LayoutStep } from '../snapshot-wizard/steps/LayoutStep'
import { ManualLayoutStep } from '../snapshot-wizard/steps/ManualLayoutStep'
import { DataSeedStep } from '../snapshot-wizard/steps/DataSeedStep'
import { SummaryStep } from '../snapshot-wizard/steps/SummaryStep'
import { ResultStep } from '../snapshot-wizard/steps/ResultStep'
import { WizardStepper } from '../snapshot-wizard/WizardStepper'
import { WizardNav } from '../snapshot-wizard/WizardNav'
import { useSnapshotWizard } from '../snapshot-wizard/use-snapshot-wizard'

/**
 * Asistente "Crear blueprint desde snapshot" (Plan 09 §6). Ruta full-page con pasos:
 * origen → preview → objetos → versionado (+manual) → datos → resumen → resultado. Admite
 * prellenado con `?serverId=&database=` desde reconciliación o el visor de snapshot.
 */
export function SnapshotWizardPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const presetServerIdRaw = params.get('serverId')
  const presetServerId = presetServerIdRaw ? Number(presetServerIdRaw) : undefined
  const presetDatabase = params.get('database') ?? undefined
  const preset =
    presetServerId && Number.isFinite(presetServerId) && presetDatabase
      ? { presetServerId, presetDatabase }
      : {}

  const wizard = useSnapshotWizard(preset)

  return (
    // Alto mínimo = viewport menos topbar (4rem) y padding de main (3rem): así la barra de
    // navegación (con `mt-auto`) queda anclada al pie en una posición ESTABLE en todos los pasos,
    // sin importar la altura del contenido del card.
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-6">
      <PageHeader
        title="Crear blueprint desde snapshot 🔌"
        description="Convierte una BD existente en un blueprint versionado. Solo lee el motor; no ejecuta DDL."
        actions={
          <Button variant="ghost" onClick={() => navigate('/database-models')}>
            Cancelar
          </Button>
        }
      />

      {wizard.step !== 'result' && <WizardStepper wizard={wizard} />}

      <Card>
        <CardContent>
          {wizard.step === 'origin' && <OriginStep wizard={wizard} />}
          {wizard.step === 'preview' && <PreviewStep wizard={wizard} />}
          {wizard.step === 'objects' && <ObjectsStep wizard={wizard} />}
          {wizard.step === 'layout' && <LayoutStep wizard={wizard} />}
          {wizard.step === 'manual' && <ManualLayoutStep wizard={wizard} />}
          {wizard.step === 'data' && <DataSeedStep wizard={wizard} />}
          {wizard.step === 'summary' && <SummaryStep wizard={wizard} />}
          {wizard.step === 'result' && wizard.result && (
            <ResultStep wizard={wizard} result={wizard.result} />
          )}
        </CardContent>
      </Card>

      {/* Navegación fija al pie, fuera del card: posición estable pese a la altura variable. */}
      <WizardNav wizard={wizard} />
    </div>
  )
}
