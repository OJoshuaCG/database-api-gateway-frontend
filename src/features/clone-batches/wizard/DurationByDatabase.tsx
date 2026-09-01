import { Badge, Button } from '@/components/ui'
import { useToast } from '@/lib/toast/use-toast'
import { isClipboardAvailable } from '@/lib/utils'
import { formatDuration } from '@/lib/utils/format'
import { formatBatchDiagnosticsReport } from './diagnostics'
import { batchQueueGapMs, durationsByDatabase, itemStatusTone } from './logic'
import type { CloneBatchItemOut, CloneBatchOut } from '@/lib/contracts'

/**
 * «Cuánto tardó cada base» — el reporte que se pidió, y que **no necesita ningún campo nuevo**
 * del backend: `CloneBatchItemOut` ya trae `started_at`/`finished_at` por ítem.
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
  // formatear y copiar, sin estado de carga.
  const copiarDiagnostico = () => {
    if (!isClipboardAvailable()) {
      toast.error(
        'No se pudo copiar',
        'El navegador no expone el portapapeles fuera de HTTPS. Abrí el gateway por HTTPS o por localhost.',
      )
      return
    }
    navigator.clipboard.writeText(formatBatchDiagnosticsReport(batch, items)).then(
      () =>
        toast.success(
          'Diagnóstico copiado',
          'Incluye el hueco medido antes de cada base. No lleva el texto de los errores del motor.',
        ),
      () => toast.error('No se pudo copiar', 'El navegador rechazó el acceso al portapapeles.'),
    )
  }

  const max = Math.max(...conDuracion.map((d) => d.ms ?? 0), 1)
  const { totalMs, sumaMs, huecoMs } = batchQueueGapMs(batch, duraciones)
  // `conDuracion` está ordenado de mayor a menor y ya se comprobó que no está vacío.
  const masLenta = conDuracion[0]!

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Cuánto tardó cada base</p>
          {/*
            El «sin atribuir» de abajo es un número sin lugar. El diagnóstico lo parte: mide el
            hueco ANTES de cada fila (fin de la anterior → arranque de ésta), que es lo único
            que el lote agrega por encima de sus jobs, y así se sabe si el tiempo perdido es del
            orquestador o de adentro de cada clon.
          */}
          <Button variant="outline" size="sm" onClick={copiarDiagnostico}>
            Copiar diagnóstico
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Cada barra mide la base completa: fotografiar el origen, crearla, aplicar la estructura
          y copiar los datos.
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
          Las dos etiquetas dicen EXACTAMENTE lo que miden, ni una palabra más.

          La primera versión decía «Copiando», y era falso: `started_at` de la fila se marca
          ANTES de `create_plan`, así que la duración por base abarca los cuatro snapshots del
          origen, la limpieza, todo el DDL y recién después los datos. En una medición real
          —17 MB, 2 m 18 s— la copia en sí valía uno o dos segundos: atribuirle el total llevaba
          a optimizar el lugar equivocado.

          Y el resto se llama «sin atribuir» y no «esperando turno» porque **no está demostrado
          qué es**: entre el fin de una fila y el inicio de la siguiente el worker solo consulta
          la cancelación y abre una sesión. Un número con una etiqueta inventada es peor que un
          número sin etiqueta.
        */}
        {huecoMs != null && huecoMs > 0 && (
          <p className="text-xs text-muted-foreground">
            Preparación y copia por base: {formatDuration(sumaMs)} · Sin atribuir:{' '}
            {formatDuration(huecoMs)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {duraciones.map((d) => (
          <div key={d.key} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-foreground" title={d.label}>
              {d.label}
            </span>
            <div className="h-2 min-w-0 flex-1 rounded-full bg-surface-muted">
              {d.ms != null && (
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(2, ((d.ms ?? 0) / max) * 100)}%` }}
                />
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
