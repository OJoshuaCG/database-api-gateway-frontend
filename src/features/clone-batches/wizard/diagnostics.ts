import { formatDuration } from '@/lib/utils/format'
import type { CloneBatchItemOut, CloneBatchOut } from '@/lib/contracts'
import { rowDurationMs } from './logic'

/**
 * La línea de tiempo del lote, fila por fila, **con los huecos entre filas**.
 *
 * `DurationByDatabase` muestra cuánto tardó cada base y un «sin atribuir» global, pero no dice
 * DÓNDE está ese resto. Acá se parte en tres lugares posibles, que son los únicos que hay en
 * un lote serie:
 *
 * - `gapBeforeMs` de la primera fila — del arranque del lote al arranque de la fila 1.
 * - `gapBeforeMs` de cada fila siguiente — del fin de la anterior al arranque de ésta. Es el
 *   verdadero «esperando turno», y ahora sí medido en vez de supuesto.
 * - `tailMs` — del fin de la última fila al fin del lote.
 *
 * Si los huecos entre filas dan casi cero, el resto está DENTRO de las filas y hay que mirar
 * el diagnóstico de cada job; si dan grande, el problema es del orquestador del lote.
 */
export interface BatchTimelineRow {
  seq: number
  sourceDatabase: string
  targetDatabase: string
  targetMode: string
  status: string
  cloneJobId: number | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  /** Del fin de la fila anterior (o del arranque del lote, para la primera) a este arranque. */
  gapBeforeMs: number | null
}

export interface BatchTimeline {
  rows: BatchTimelineRow[]
  totalMs: number | null
  /** Suma de las duraciones de las filas. */
  rowsMs: number
  /** Suma de los huecos entre filas. */
  gapsMs: number
  tailMs: number | null
}

function diffMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function buildBatchTimeline(
  batch: CloneBatchOut,
  items: CloneBatchItemOut[],
): BatchTimeline {
  // Por `seq`, que es el orden REAL de ejecución del lote serie. `durationsByDatabase` ordena
  // por magnitud y acá eso rompería el cálculo de huecos.
  const ordered = [...items].sort((a, b) => a.seq - b.seq)

  let previousEnd: string | null | undefined = batch.started_at
  const rows: BatchTimelineRow[] = ordered.map((item) => {
    const gapBeforeMs = diffMs(previousEnd, item.started_at)
    if (item.finished_at) previousEnd = item.finished_at
    return {
      seq: item.seq,
      sourceDatabase: item.source_database_name,
      targetDatabase: item.target_database_name,
      targetMode: item.target_mode,
      status: item.status ?? 'pendiente',
      cloneJobId: item.clone_job_id ?? null,
      startedAt: item.started_at ?? null,
      finishedAt: item.finished_at ?? null,
      durationMs: rowDurationMs(item),
      gapBeforeMs,
    }
  })

  return {
    rows,
    totalMs: rowDurationMs(batch),
    rowsMs: rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0),
    gapsMs: rows.reduce((acc, r) => acc + (r.gapBeforeMs ?? 0), 0),
    tailMs: diffMs(previousEnd, batch.finished_at),
  }
}

function ms(value: number | null): string {
  return value == null ? '—' : `${value} ms (${formatDuration(value)})`
}

/**
 * Diagnóstico del lote en Markdown.
 *
 * **No incluye `error` ni `reason`.** Pueden traer texto del motor —host, usuario, fragmentos
 * de sentencia— y esto va al portapapeles y de ahí a una conversación. Va el `error_code`, que
 * es de vocabulario cerrado y es lo que sirve para diagnosticar.
 */
export function formatBatchDiagnosticsReport(
  batch: CloneBatchOut,
  items: CloneBatchItemOut[],
): string {
  const t = buildBatchTimeline(batch, items)
  const lines: string[] = []

  lines.push(`# Diagnóstico del lote #${batch.id}`)
  lines.push('')
  lines.push(`- Servidores: ${batch.source_server_id} → ${batch.target_server_id}`)
  lines.push(`- Qué copia: ${batch.copy_intent}`)
  lines.push(`- Bases: ${batch.total} · estado: ${batch.status}`)
  lines.push(`- Arrancó: ${batch.started_at ?? '—'} · terminó: ${batch.finished_at ?? '—'}`)
  lines.push(`- **Total: ${ms(t.totalMs)}**`)
  lines.push(`- Suma de las filas: ${ms(t.rowsMs)}`)
  lines.push(`- Suma de los huecos entre filas: ${ms(t.gapsMs)}`)
  lines.push(`- Cola tras la última fila: ${ms(t.tailMs)}`)
  lines.push('')
  lines.push(
    'El lote corre en SERIE, así que el total no es la suma de las filas. `hueco antes` mide ' +
      'del fin de la fila anterior al arranque de ésta (para la primera, desde el arranque del ' +
      'lote). Si los huecos son chicos, el tiempo está dentro de las filas: copiar el ' +
      'diagnóstico del job más lento desde «ver detalle».',
  )
  lines.push('')
  lines.push('| seq | Base destino | Modo | Estado | job | Hueco antes | Duración | started_at | finished_at |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of t.rows) {
    lines.push(
      `| ${r.seq} | ${r.targetDatabase} | ${r.targetMode} | ${r.status} | ` +
        `${r.cloneJobId ?? '—'} | ${ms(r.gapBeforeMs)} | ${ms(r.durationMs)} | ` +
        `${r.startedAt ?? '—'} | ${r.finishedAt ?? '—'} |`,
    )
  }

  const conCodigo = items.filter((i) => i.error_code)
  if (conCodigo.length > 0) {
    lines.push('')
    lines.push('## Filas con error (solo el código, nunca el texto del motor)')
    lines.push('')
    for (const i of conCodigo) {
      lines.push(`- seq ${i.seq} · \`${i.target_database_name}\` → \`${i.error_code}\``)
    }
  }

  return lines.join('\n')
}
