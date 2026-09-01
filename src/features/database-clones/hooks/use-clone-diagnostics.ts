import { useMutation } from '@tanstack/react-query'
import { toApiError } from '@/lib/api/errors'
import type { CloneSummaryOut } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { downloadBlob, isClipboardAvailable, safeFilenamePart } from '@/lib/utils'
import { fetchAllCloneItems } from '../api/database-clones.api'
import { formatCloneDiagnosticsReport } from '../logic/diagnostics'

/** Cómo sale el diagnóstico: al portapapeles o a un archivo. */
export type DiagnosticsDelivery = 'clipboard' | 'download'

/**
 * Arma el diagnóstico de rendimiento del job y lo entrega.
 *
 * Trae TODOS los pasos (no la página visible) porque el reparto por fase necesita el último
 * `executed_at` de cada tramo, y ése puede caer en cualquier página. Va como mutation y no
 * como query para que las ~10 requests salgan **solo al apretar el botón**: el monitor hace
 * polling y colgarlo de una query lo repetiría en cada vuelta.
 *
 * **La descarga existe porque el portapapeles no siempre está.** `navigator.clipboard` está
 * restringida a contextos seguros y este gateway se sirve por HTTP plano, donde simplemente no
 * existe — copiar era imposible en el despliegue real. `downloadBlob` no tiene esa restricción,
 * así que la descarga es el camino que **siempre** funciona y el copiar es el atajo cuando se
 * puede.
 */
export function useCloneDiagnostics(job: CloneSummaryOut | undefined) {
  const toast = useToast()

  return useMutation<DiagnosticsDelivery, unknown, DiagnosticsDelivery>({
    mutationFn: async (delivery) => {
      if (!job) throw new Error('Todavía no se cargó el estado del clon.')
      if (delivery === 'clipboard' && !isClipboardAvailable()) {
        throw new Error(
          'El navegador no expone el portapapeles fuera de HTTPS. Usá «Descargar .txt», que funciona igual.',
        )
      }

      const items = await fetchAllCloneItems(job.id)
      const reporte = formatCloneDiagnosticsReport(job, items)

      if (delivery === 'clipboard') {
        await navigator.clipboard.writeText(reporte)
      } else {
        // El nombre de la base es eco del motor ajeno: se sanea antes de ser nombre de archivo.
        const nombre = `diagnostico-clon-${job.id}-${safeFilenamePart(job.source_database_name)}.txt`
        downloadBlob(new Blob([reporte], { type: 'text/plain;charset=utf-8' }), nombre)
      }
      return delivery
    },
    onSuccess: (delivery) =>
      toast.success(
        delivery === 'clipboard' ? 'Diagnóstico copiado' : 'Diagnóstico descargado',
        'Incluye el reparto del tiempo por fase y todos los pasos. No lleva el texto de los errores del motor.',
      ),
    onError: (error) => toast.error('No se pudo generar el diagnóstico', toApiError(error).message),
  })
}
