import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardContent, PageHeader } from '@/components/ui'
import { AdoptConfirmStep } from '../wizard/steps/AdoptConfirmStep'
import { AdoptSelectStep } from '../wizard/steps/AdoptSelectStep'
import { ExecuteConfirmStep } from '../wizard/steps/ExecuteConfirmStep'
import { ExecuteSelectStep } from '../wizard/steps/ExecuteSelectStep'
import { ItemsStep } from '../wizard/steps/ItemsStep'
import { ResultStep } from '../wizard/steps/ResultStep'
import { SelectorStep } from '../wizard/steps/SelectorStep'
import { SummaryStep } from '../wizard/steps/SummaryStep'
import { WizardNav } from '../wizard/WizardNav'
import { WizardStepper } from '../wizard/WizardStepper'
import { useSchemaComparisonWizard } from '../wizard/use-schema-comparison-wizard'

/**
 * Asistente "Comparar esquemas": selector de dos BDs → resumen del diff → detalle del DDL →
 * adoptar como versión del blueprint (Opción A) o ejecutar directo (Opción B) → resultado.
 * Ruta full-page con pasos internos, admite prellenado con `?targetDatabaseId=` desde la fila
 * "Comparar esquema" de una BD gestionada.
 */
export function SchemaComparisonWizardPage() {
  const [params] = useSearchParams()
  const presetTargetIdRaw = params.get('targetDatabaseId')

  // La misma ruta (`/schema-comparisons`, con o sin `?targetDatabaseId=`) es el único punto de
  // entrada — React Router NO remonta el elemento solo porque cambie el query string. Sin esta
  // `key`, navegar aquí de nuevo (p. ej. el ítem del sidebar) mientras el asistente ya está a
  // mitad de flujo no hace nada visible: el estado viejo del asistente sigue intacto bajo la URL
  // nueva. La `key` fuerza un remount (asistente en blanco) cada vez que cambia el prellenado.
  return <SchemaComparisonWizardContent key={presetTargetIdRaw ?? 'blank'} presetTargetIdRaw={presetTargetIdRaw} />
}

function SchemaComparisonWizardContent({ presetTargetIdRaw }: { presetTargetIdRaw: string | null }) {
  const navigate = useNavigate()

  const presetTargetId = presetTargetIdRaw ? Number(presetTargetIdRaw) : undefined
  const preset =
    presetTargetId !== undefined && Number.isFinite(presetTargetId) ? { presetTargetId } : {}

  const wizard = useSchemaComparisonWizard(preset)

  return (
    // Alto mínimo = viewport menos topbar/padding: la barra de navegación (con `mt-auto`) queda
    // anclada al pie en una posición ESTABLE en todos los pasos, sin importar la altura del card.
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-6">
      <PageHeader
        title="Comparar esquemas"
        description="Compara la estructura de dos bases de datos del mismo motor y actúa sobre el diff."
        actions={
          <Button variant="ghost" onClick={() => navigate('/managed-databases')}>
            Cancelar
          </Button>
        }
      />

      {wizard.step !== 'result' && <WizardStepper wizard={wizard} />}

      <Card>
        <CardContent>
          {wizard.step === 'selector' && <SelectorStep wizard={wizard} />}
          {wizard.step === 'summary' && <SummaryStep wizard={wizard} />}
          {wizard.step === 'items' && <ItemsStep wizard={wizard} />}
          {wizard.step === 'adoptSelect' && <AdoptSelectStep wizard={wizard} />}
          {wizard.step === 'adoptConfirm' && <AdoptConfirmStep wizard={wizard} />}
          {wizard.step === 'executeSelect' && <ExecuteSelectStep wizard={wizard} />}
          {wizard.step === 'executeConfirm' && <ExecuteConfirmStep wizard={wizard} />}
          {wizard.step === 'result' && <ResultStep wizard={wizard} />}
        </CardContent>
      </Card>

      <WizardNav wizard={wizard} />
    </div>
  )
}
