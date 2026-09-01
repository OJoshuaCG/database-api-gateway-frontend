import { Badge, Button } from '@/components/ui'
import { useToast } from '@/lib/toast/use-toast'
import { downloadBlob, isClipboardAvailable } from '@/lib/utils'
import { formatDuration } from '@/lib/utils/format'
import { formatBatchDiagnosticsReport } from './diagnostics'
import { batchQueueGapMs, durationsByDatabase, itemStatusTone } from './logic'
import type { CloneBatchItemOut, CloneBatchOut } from '@/lib/contracts'

/**
 * «Cuánto tardó cada base», con la barra partida en preparación y ejecución.
 *
 * La primera versión decía que esto «no necesita ningún campo nuevo del backend» porque
 * `CloneBatchItemOut` ya traía `started_at`/`finished_at` por ítem. Los traía **sobrescritos**:
 * el serializer devolvía los del job en cuanto la fila tenía uno, así que la preparación —dos
 * snapshots completos del origen y una consulta de estadísticas por tabla— caía fuera de la
 * barra y aparecía como un bloque «sin atribuir» de ~25 s por base. Sí hicieron falta campos
 * nuevos: `job_started_at`/`job_finished_at`.
 *
 * Barras HORIZONTALES y ordenadas de mayor a menor, no una línea temporal ni una torta. Es
 * comparar una magnitud entre N categorías CON NOMBRE: horizontal deja los nombres de base
 * legibles sin rotarlos ni truncarlos, y el orden por magnitud pone al culpable en la primera
 * fila. Una línea sugeriría una tendencia donde el eje es «orden del lote», no tiempo.
 */
export function DurationByDatabase({
  batch,
  items,
}: {
  batch: CloneBatchOut
  items: CloneBatchItemOut[]
}) {
  // Antes del early return: un hook no puede quedar detrás de un `return` condicional.
  const toast = useToast()

  const duraciones = durationsByDatabase(items)
  const conDuracion = duraciones.filter((d) => d.ms != null)
  if (conDuracion.length === 0) return null

  // Las filas ya están en memoria (llegan por props), así que no hay nada que pedir: esto es
  // formatear y entregar, sin estado de carga.
  const descargarDiagnostico = () => {
    const reporte = formatBatchDiagnosticsReport(batch, items)
    downloadBlob(new Blob([reporte], { type: 'text/plain;charset=utf-8' }), `diagnostico-lote-${batch.id}.txt`)
    toast.success(
      'Diagnóstico descargado',
      'Incluye la preparación y la ejecución de cada base. No lleva el texto de los errores del motor.',
    )
  }

  const copiarDiagnostico = () => {
    navigator.clipboard.writeText(formatBatchDiagnosticsReport(batch, items)).then(
      () => toast.success('Diagnóstico copiado'),
      () => toast.error('No se pudo copiar', 'Usá «Descargar .txt», que funciona igual.'),
    )
  }

  const max = Math.max(...conDuracion.map((d) => d.ms ?? 0), 1)
  const { totalMs, huecoMs } = batchQueueGapMs(batch, duraciones)
  const prepTotalMs = duraciones.reduce((acc, d) => acc + (d.prepMs ?? 0), 0)
  const execTotalMs = duraciones.reduce((acc, d) => acc + (d.execMs ?? 0), 0)
  // `conDuracion` está ordenado de mayor a menor y ya se comprobó que no está vacío.
  const masLenta = conDuracion[0]!

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Cuánto tardó cada base</p>
          {/*
            El diagnóstico trae fila por fila la preparación, la ejecución y el hueco entre
            filas, que es lo que el gráfico resume. La descarga es la acción principal porque
            este gateway se sirve por HTTP plano y ahí `navigator.clipboard` no existe: el
            copiar solo se ofrece cuando el contexto es seguro.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={descargarDiagnostico}>
              Descargar diagnóstico (.txt)
            </Button>
            {isClipboardAvailable() && (
              <Button variant="ghost" size="sm" onClick={copiarDiagnostico}>
                Copiar
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Cada barra mide la base completa, partida en dos:{' '}
          <span className="font-medium text-warning">preparación</span> (fotografiar el origen y
          armar la vista previa) y{' '}
          <span className="font-medium text-primary">ejecución</span> (crearla, aplicar la
          estructura y copiar los datos).
        </p>
        {totalMs != null && (
          <p className="text-xs text-muted-foreground">
            {conDuracion.length} bases en {formatDuration(totalMs)}. La más lenta (
            <strong className="text-foreground">{masLenta.label}</strong>,{' '}
            {formatDuration(masLenta.ms ?? 0)}) se llevó el{' '}
            {Math.round(((masLenta.ms ?? 0) / totalMs) * 100)} % del total.
          </p>
        )}
        {/*
          Las etiquetas dicen EXACTAMENTE lo que miden, ni una palabra más. Ya se equivocaron dos
          veces y cada vez mandaron a optimizar el lugar equivocado.

          La primera versión decía «Copiando»: falso, porque la fila arranca antes de
          `create_plan` y el total incluye snapshots, limpieza y DDL — en una medición real de
          17 MB en 2 m 18 s, la copia valía uno o dos segundos.

          La segunda llamó «sin atribuir» al resto porque no estaba demostrado qué era. Ahora sí:
          la API sustituía `started_at`/`finished_at` por los del JOB, así que la preparación
          —dos snapshots completos del origen y una consulta de estadísticas por tabla— quedaba
          fuera de la barra. Eran ~25 s por base, idénticos entre dos corridas con trabajo muy
          distinto, que es la firma de un costo fijo. El backend ahora manda los dos pares de
          relojes y la preparación se muestra como lo que es.
        */}
        {prepTotalMs > 0 && (
          <p className="text-xs text-muted-foreground">
            Preparación: {formatDuration(prepTotalMs)} · Ejecución: {formatDuration(execTotalMs)}
            {huecoMs != null && huecoMs > 0 && ` · Sin atribuir: ${formatDuration(huecoMs)}`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {duraciones.map((d) => (
          <div key={d.key} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-foreground" title={d.label}>
              {d.label}
            </span>
            {/*
              Barra apilada: preparación y ejecución comparten la misma escala, así que se ve de
              un vistazo qué mitad se lleva el tiempo. Cuando el backend no manda los relojes del
              job —una fila vieja, o una que no llegó a materializarse— se cae a la barra entera,
              que es el comportamiento anterior y sigue siendo cierto.
            */}
            <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
              {d.prepMs != null || d.execMs != null ? (
                <>
                  <div
                    className="h-2 bg-warning"
                    style={{ width: `${((d.prepMs ?? 0) / max) * 100}%` }}
                    title={`Preparación: ${formatDuration(d.prepMs ?? 0)}`}
                  />
                  <div
                    className="h-2 bg-primary"
                    style={{ width: `${((d.execMs ?? 0) / max) * 100}%` }}
                    title={`Ejecución: ${formatDuration(d.execMs ?? 0)}`}
                  />
                </>
              ) : (
                d.ms != null && (
                  <div
                    className="h-2 bg-primary"
                    style={{ width: `${Math.max(2, ((d.ms ?? 0) / max) * 100)}%` }}
                  />
                )
              )}
            </div>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
              {d.ms != null ? formatDuration(d.ms) : '—'}
            </span>
            <Badge tone={itemStatusTone(d.status)}>{d.status ?? '—'}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
