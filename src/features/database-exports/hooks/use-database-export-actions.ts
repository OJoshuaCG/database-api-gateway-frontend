import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { downloadBlob } from '@/lib/utils'
import type { ExportArtifactDelivery, ExportPreview, ExportSummary } from '@/lib/contracts'
import {
  cancelDatabaseExport,
  createDatabaseExport,
  downloadExportArtifact,
  executeDatabaseExport,
  getExportContent,
  previewDatabaseExport,
  type ExportExecuteIn,
  type ExportPreviewIn,
  type ExportSpecPayload,
} from '../api/database-exports.api'

/**
 * Mutaciones "propiedad del asistente" (mismo patrón que `database-clones` y
 * `collation-conversions`): el error NO se notifica por toast global — cada paso renderiza el
 * `ApiError` inline con su CTA de recuperación (422 opción incompatible / dependencias faltantes,
 * 409 anti-TOCTOU, 410 plan vencido). Las acciones SUELTAS del final (cancelar, descargar, copiar)
 * sí llevan `onError`, porque no tienen un paso del wizard donde pintarse.
 */

/**
 * Crea el plan 🔌 (10/min). Sin toast de éxito a propósito: crear el plan es un paso intermedio del
 * asistente —el usuario ni siquiera eligió los objetos todavía—, no un logro que anunciar.
 */
export function useCreateDatabaseExport(serverId: number, database: string) {
  return useMutation<ExportSummary, unknown, ExportSpecPayload>({
    mutationFn: (body) => createDatabaseExport(serverId, database, body),
  })
}

/**
 * Preview AUTORITATIVO 🔌 (10/min): congela la selección y emite el `confirm_token`. Es una
 * mutación y no una query justamente por eso — tiene efecto persistente y nunca debe refetchearse
 * sola. Invalida el detalle porque el preview cambia `has_resolved_selection`.
 *
 * El panel vivo de consecuencias NO usa esto: usa `useExportDryRunPreview`, que fuerza
 * `dry_run_only: true`.
 */
export function useExportPreview(jobId: number) {
  const queryClient = useQueryClient()
  return useMutation<ExportPreview, unknown, ExportPreviewIn>({
    mutationFn: (body) => previewDatabaseExport(jobId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.detail(jobId) })
    },
  })
}

/** Ejecuta 🔌 (3/min): valida el doble factor y ENCOLA el job; el avance se sigue por polling. */
export function useExecuteDatabaseExport(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<ExportSummary, unknown, ExportExecuteIn>({
    mutationFn: (body) => executeDatabaseExport(jobId, body),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.detail(jobId) })
      toast.success('Exportación encolada', `Job #${summary.id} · sigue el avance en el monitor.`)
    },
  })
}

/** Cancelación cooperativa: el worker corta en el próximo punto seguro. */
export function useCancelDatabaseExport(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<ExportSummary, unknown, void>({
    mutationFn: () => cancelDatabaseExport(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.detail(jobId) })
      toast.success('Cancelación solicitada', 'El worker cortará en el próximo punto seguro.')
    },
    onError: (error) => toast.error('No se pudo cancelar', toApiError(error).message),
  })
}

/**
 * Descarga del artefacto (3/min). Acción suelta, no un paso del asistente: el error se notifica por
 * toast.
 *
 * Es de UN SOLO USO — al completarse, el artefacto pasa a `consumed` y un segundo intento es 410 —,
 * así que se invalidan tanto el detalle como el manifiesto: los dos cambian de estado con la
 * descarga (y el manifiesto sigue respondiendo después, que es lo que permite saber qué se llevó
 * uno cuando el archivo ya no está).
 *
 * Devuelve el `delivery` como `data` para que la pantalla pueda advertir de un artefacto PARCIAL
 * (`complete === false`) y mostrar el sha256 con el que verificar el archivo.
 */
export function useDownloadExportArtifact(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<ExportArtifactDelivery, unknown, void>({
    mutationFn: async () => {
      const { blob, filename, delivery } = await downloadExportArtifact(jobId)
      downloadBlob(blob, filename)
      return delivery
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.detail(jobId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.manifest(jobId) })
      toast.success(
        'Descarga iniciada',
        'El artefacto quedó consumido: no se puede volver a descargar.',
      )
    },
    onError: (error) => toast.error('No se pudo descargar el artefacto', toApiError(error).message),
  })
}

/**
 * Copia el artefacto al portapapeles (3/min). Mismas condiciones que la descarga: un solo uso y
 * cada lectura queda auditada, así que también invalida detalle y manifiesto.
 *
 * El `writeText` va en su propio `try/catch` porque puede fallar por permisos o por contexto no
 * seguro DESPUÉS de que el artefacto ya se consumió: en ese caso el toast tiene que decir que el
 * texto no se copió —en vez de mentir con un «copiado»— y devolver `copied: false` para que la
 * pantalla ofrezca el texto de otra forma.
 */
export function useCopyExportContent(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<{ delivery: ExportArtifactDelivery; copied: boolean }, unknown, void>({
    mutationFn: async () => {
      const { text, delivery } = await getExportContent(jobId)
      try {
        await navigator.clipboard.writeText(text)
        return { delivery, copied: true }
      } catch {
        return { delivery, copied: false }
      }
    },
    onSuccess: ({ copied }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.detail(jobId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseExports.manifest(jobId) })
      if (copied) {
        toast.success(
          'Contenido copiado',
          'El artefacto quedó consumido: no se puede volver a obtener.',
        )
      } else {
        toast.error(
          'No se pudo copiar al portapapeles',
          'El navegador denegó el acceso. El artefacto ya quedó consumido.',
        )
      }
    },
    onError: (error) => toast.error('No se pudo obtener el contenido', toApiError(error).message),
  })
}
