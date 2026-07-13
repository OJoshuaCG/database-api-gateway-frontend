import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import type {
  AdoptComparisonIn,
  AdoptComparisonOut,
  CreateSchemaComparisonIn,
  ExecuteComparisonIn,
  ExecuteComparisonOut,
  SchemaComparisonSummaryOut,
} from '@/lib/contracts'
import { adoptComparison, createSchemaComparison, executeComparison } from '../api/schema-comparisons.api'

/**
 * Mutaciones "propiedad del asistente" (mismo patrón documentado en
 * `use-from-snapshot.ts`): el error NO se notifica por toast global — cada paso del asistente
 * renderiza el `ApiError` inline (409/410/422/429, con CTAs específicos como "Recalcular" o
 * "Ir a Opción A/B"), porque un asistente de página completa necesita errores accionables en
 * contexto, no una notificación efímera. El éxito sí emite un toast de confirmación.
 */
export function useCreateSchemaComparison() {
  const toast = useToast()
  return useMutation<SchemaComparisonSummaryOut, unknown, CreateSchemaComparisonIn>({
    mutationFn: (body) => createSchemaComparison(body),
    onSuccess: (summary) => {
      toast.success(
        'Comparación creada',
        `${summary.item_count} sentencia(s) · ${summary.source_engine} → ${summary.target_engine}`,
      )
    },
  })
}

export function useAdoptComparison(comparisonId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<AdoptComparisonOut, unknown, AdoptComparisonIn>({
    mutationFn: (body) => adoptComparison(comparisonId, body),
    onSuccess: (result) => {
      // Se creó una versión nueva en el blueprint del target; si se aplicó de inmediato, también
      // cambió el model_version de la BD gestionada.
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      toast.success(
        `Versión ${result.version} adoptada`,
        result.executed
          ? `${result.statements} sentencia(s) · aplicada al target`
          : `${result.statements} sentencia(s) · pendiente de revisión`,
      )
    },
  })
}

export function useExecuteComparison(comparisonId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<ExecuteComparisonOut, unknown, { body: ExecuteComparisonIn; force: boolean }>({
    mutationFn: ({ body, force }) => executeComparison(comparisonId, body, force),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
      if (result.failed) {
        toast.error(
          'Ejecución detenida por un fallo',
          `${result.applied_count} de ${result.total} sentencia(s) aplicada(s)`,
        )
      } else {
        toast.success(
          'Diff ejecutado sobre el target',
          `${result.applied_count} de ${result.total} sentencia(s) aplicada(s)`,
        )
      }
    },
  })
}
