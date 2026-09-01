import { useMutation } from '@tanstack/react-query'
import { toApiError } from '@/lib/api/errors'
import type { CloneSummaryOut } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { isClipboardAvailable } from '@/lib/utils'
import { fetchAllCloneItems } from '../api/database-clones.api'
import { formatCloneDiagnosticsReport } from '../logic/diagnostics'

/**
 * Arma el diagnóstico de rendimiento del job y lo deja en el portapapeles.
 *
 * Trae TODOS los pasos (no la página visible) porque el reparto por fase necesita el último
 * `executed_at` de cada tramo, y ése puede caer en cualquier página. Va como mutation y no
 * como query para que las ~10 requests salgan **solo al apretar el botón**: el monitor hace
 * polling y colgarlo de una query lo repetiría en cada vuelta.
 *
 * A diferencia del artefacto de exportación, acá no se consume nada irrecuperable, así que el
 * `isClipboardAvailable` es una cortesía —avisar antes en vez de fallar después— y no un
 * requisito de corrección.
 */
export function useCopyCloneDiagnostics(job: CloneSummaryOut | undefined) {
  const toast = useToast()

  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      if (!job) throw new Error('Todavía no se cargó el estado del clon.')
      if (!isClipboardAvailable()) {
        throw new Error(
          'El navegador no expone el portapapeles fuera de HTTPS. Abrí el gateway por HTTPS o por localhost.',
        )
      }
      const items = await fetchAllCloneItems(job.id)
      await navigator.clipboard.writeText(formatCloneDiagnosticsReport(job, items))
    },
    onSuccess: () =>
      toast.success(
        'Diagnóstico copiado',
        'Incluye el reparto del tiempo por fase y todos los pasos. No lleva el texto de los errores del motor.',
      ),
    onError: (error) =>
      toast.error('No se pudo copiar el diagnóstico', toApiError(error).message),
  })
}
