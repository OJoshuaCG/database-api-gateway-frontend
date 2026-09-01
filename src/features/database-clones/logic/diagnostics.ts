import { formatDuration } from '@/lib/utils'
import type { CloneItemKind, CloneItemOut, CloneSummaryOut } from '@/lib/contracts'

/**
 * Reparto del tiempo de un job de clonado, para responder «¿en qué se fue el reloj?».
 *
 * ## Por qué el reparto es POR FASE y no por paso
 *
 * `executed_at` **no** es el momento en que corrió el paso. El backend ejecuta la fase entera
 * (`execute_adhoc` devuelve todos los resultados) y recién después arma las filas con
 * `executed_at=_utcnow()` dentro del bucle, así que **todos los pasos de una fase comparten
 * timestamp** salvo microsegundos. Lo mismo vale para la fase de datos.
 *
 * Por eso acá NO hay «hueco por paso»: restar los `executed_at` de dos pasos vecinos de la
 * misma fase da cero, y presentarlo como si midiera algo sería inventar precisión. Lo que sí
 * es real es el timestamp del ÚLTIMO paso de cada fase ≈ el momento en que esa fase terminó, y
 * de ahí sale un reparto por fase que sí se sostiene.
 *
 * ## Qué mide cada número
 *
 * - `measuredMs` — suma de `execution_ms`. Es lo único que el motor reportó: el
 *   `conn.exec_driver_sql` de cada sentencia, **sin** la apertura de conexión ni el resto.
 * - `wallMs` — reloj de pared de la fase, del fin de la anterior al fin de ésta.
 * - `unattributedMs` — `wallMs − measuredMs`. **Es el número que importa**: trabajo real que
 *   ningún paso declara (abrir conexiones, reintentos diferidos cuyo intento fallido se
 *   sobrescribe, `information_schema`, DNS, handshakes).
 * - `beforeFirstPhaseMs` — de `started_at` al fin de la primera fase, menos lo medido en ella.
 *   Acá cae el snapshot anti-TOCTOU del origen, su fingerprint, el plan de ejecución y el
 *   advisory lock. Ninguno de los cuatro emite un paso.
 */
export interface PhaseSlice {
  kind: CloneItemKind
  /** Una `kind` puede aparecer en más de un tramo, así que el tramo se identifica por su rango. */
  seqFrom: number
  seqTo: number
  steps: number
  failed: number
  skipped: number
  rowsCopied: number | null
  measuredMs: number
  /** Cuántos pasos del tramo no traen `execution_ms` (el backend no lo registra en todos). */
  stepsWithoutMs: number
  endedAt: string | null
  wallMs: number | null
  unattributedMs: number | null
}

export interface CloneDiagnostics {
  slices: PhaseSlice[]
  beforeFirstPhaseMs: number | null
  /** Del fin del último tramo a `finished_at`: adopción, cierre y persistencia final. */
  afterLastPhaseMs: number | null
  totalMs: number | null
  measuredMs: number
  /** `totalMs − measuredMs`. Si domina, el costo no está en ejecutar sentencias. */
  unattributedMs: number | null
}

/**
 * Milisegundos entre dos timestamps del backend.
 *
 * Los `datetime` del gateway viajan **sin zona** (columna `DateTime`, `_utcnow()` naive), así
 * que `new Date(...)` los interpreta como hora LOCAL. No importa: acá solo se usan DIFERENCIAS
 * entre dos valores parseados igual, y el desplazamiento se cancela. Lo que nunca hay que
 * hacer es compararlos contra el reloj del navegador.
 */
function diffMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return b - a
}

/** Agrupa los pasos en tramos CONTIGUOS de la misma `kind`, en orden de `seq`. */
function toSlices(items: CloneItemOut[]): PhaseSlice[] {
  const ordered = [...items].sort((a, b) => a.seq - b.seq)
  const slices: PhaseSlice[] = []

  for (const item of ordered) {
    let slice = slices.at(-1)
    if (!slice || slice.kind !== item.kind) {
      slice = {
        kind: item.kind,
        seqFrom: item.seq,
        seqTo: item.seq,
        steps: 0,
        failed: 0,
        skipped: 0,
        rowsCopied: null,
        measuredMs: 0,
        stepsWithoutMs: 0,
        endedAt: null,
        wallMs: null,
        unattributedMs: null,
      }
      slices.push(slice)
    }

    slice.seqTo = item.seq
    slice.steps += 1
    if (item.status === 'failed') slice.failed += 1
    if (item.status === 'skipped') slice.skipped += 1
    if (item.rows_copied != null) slice.rowsCopied = (slice.rowsCopied ?? 0) + item.rows_copied
    if (item.execution_ms != null) slice.measuredMs += item.execution_ms
    else slice.stepsWithoutMs += 1

    // Un paso que nunca se ejecutó (`skipped` por corte de la fase) no trae `executed_at`, y
    // no debe correr el fin del tramo hacia atrás.
    if (item.executed_at && (!slice.endedAt || item.executed_at > slice.endedAt)) {
      slice.endedAt = item.executed_at
    }
  }

  return slices
}

export function buildCloneDiagnostics(
  job: CloneSummaryOut,
  items: CloneItemOut[],
): CloneDiagnostics {
  const slices = toSlices(items)

  // El reloj de pared de cada tramo se mide contra el fin del tramo ANTERIOR que tenga
  // timestamp. Un tramo entero de pasos `skipped` no tiene fin propio y no debe romper la
  // cadena del siguiente.
  let previousEnd: string | null = job.started_at
  for (const slice of slices) {
    if (!slice.endedAt) continue
    slice.wallMs = diffMs(previousEnd, slice.endedAt)
    slice.unattributedMs = slice.wallMs == null ? null : slice.wallMs - slice.measuredMs
    previousEnd = slice.endedAt
  }

  const first = slices.find((s) => s.endedAt)
  const totalMs = diffMs(job.started_at, job.finished_at)
  const measuredMs = slices.reduce((acc, s) => acc + s.measuredMs, 0)

  return {
    slices,
    beforeFirstPhaseMs: first?.unattributedMs ?? null,
    afterLastPhaseMs: diffMs(previousEnd, job.finished_at),
    totalMs,
    measuredMs,
    unattributedMs: totalMs == null ? null : totalMs - measuredMs,
  }
}

const KIND_LABELS: Record<CloneItemKind, string> = {
  clean: 'Limpieza',
  structure: 'Estructura',
  data: 'Datos',
  adopt: 'Adopción',
}

function ms(value: number | null): string {
  return value == null ? '—' : `${value} ms (${formatDuration(value)})`
}

/**
 * Diagnóstico en Markdown, para pegar en un chat.
 *
 * **No incluye el texto de `error`.** Un error del motor puede traer host, usuario o fragmentos
 * de sentencia, y esto va al portapapeles y de ahí a una conversación — es la misma razón por
 * la que el backend nunca vuelca `str(exc)` en una respuesta. Se informa CUÁNTOS pasos
 * fallaron y en qué tramo, que es lo que hace falta para diagnosticar tiempo.
 */
export function formatCloneDiagnosticsReport(
  job: CloneSummaryOut,
  items: CloneItemOut[],
): string {
  const d = buildCloneDiagnostics(job, items)
  const lines: string[] = []

  lines.push(`# Diagnóstico del clon #${job.id}`)
  lines.push('')
  lines.push(`- Origen: servidor ${job.source_server_id} · \`${job.source_database_name}\` (${job.source_engine})`)
  lines.push(`- Destino: servidor ${job.target_server_id} · \`${job.target_database_name}\` (${job.target_engine})`)
  lines.push(`- Modo de destino: ${job.target_mode} · limpieza: ${job.clean_mode}`)
  lines.push(`- Qué copia: ${job.copy_intent ?? (job.include_data ? 'structure_and_data' : 'structure_only')}`)
  lines.push(`- Cross-engine: ${job.cross_engine ? 'sí' : 'no'} · adopta destino: ${job.adopt_target ? 'sí' : 'no'}`)
  lines.push(`- Estado: ${job.status}${job.error ? ' (con error)' : ''}`)
  lines.push(`- Arrancó: ${job.started_at ?? '—'} · terminó: ${job.finished_at ?? '—'}`)
  lines.push(`- **Total: ${ms(d.totalMs)}**`)
  lines.push(`- Pasos registrados: ${items.length}`)
  lines.push('')

  lines.push('## Reparto del tiempo')
  lines.push('')
  lines.push(
    'El reparto es POR FASE, no por paso: el backend sella `executed_at` cuando registra la ' +
      'fase entera, así que todos los pasos de una fase comparten timestamp. `medido` es la ' +
      'suma de `execution_ms` (solo el `execute` de cada sentencia); `sin atribuir` es el resto ' +
      'del reloj de pared de esa fase — conexiones, catálogo, reintentos que no se registran.',
  )
  lines.push('')
  lines.push('| Tramo | seq | Pasos | Reloj de pared | Medido | Sin atribuir |')
  lines.push('|---|---|---|---|---|---|')

  const preLabel = 'ANTES DE LA 1ª FASE (snapshot + fingerprint + plan + lock)'
  lines.push(`| ${preLabel} | — | 0 | — | 0 ms | ${ms(d.beforeFirstPhaseMs)} |`)

  for (const s of d.slices) {
    const extra: string[] = []
    if (s.failed) extra.push(`${s.failed} fallidos`)
    if (s.skipped) extra.push(`${s.skipped} omitidos`)
    if (s.stepsWithoutMs) extra.push(`${s.stepsWithoutMs} sin ms`)
    if (s.rowsCopied != null) extra.push(`${s.rowsCopied} filas`)
    const label = extra.length ? `${KIND_LABELS[s.kind]} (${extra.join(', ')})` : KIND_LABELS[s.kind]
    // La primera fase ya declaró su «sin atribuir» en la fila de arriba: repetirlo lo contaría dos veces.
    const unattributed = s === d.slices.find((x) => x.endedAt) ? '(arriba)' : ms(s.unattributedMs)
    lines.push(
      `| ${label} | ${s.seqFrom}–${s.seqTo} | ${s.steps} | ${ms(s.wallMs)} | ${ms(s.measuredMs)} | ${unattributed} |`,
    )
  }

  lines.push(`| DESPUÉS DE LA ÚLTIMA FASE (adopción y cierre) | — | 0 | — | 0 ms | ${ms(d.afterLastPhaseMs)} |`)
  lines.push('')
  lines.push(`**Medido por los pasos: ${ms(d.measuredMs)}. Sin atribuir en total: ${ms(d.unattributedMs)}.**`)
  lines.push('')

  lines.push('## Los 20 pasos más lentos')
  lines.push('')
  lines.push('| seq | Tramo | Objeto | Estado | Filas | ms |')
  lines.push('|---|---|---|---|---|---|')
  for (const item of [...items].sort((a, b) => (b.execution_ms ?? -1) - (a.execution_ms ?? -1)).slice(0, 20)) {
    lines.push(
      `| ${item.seq} | ${item.kind} | ${item.object_type} · ${item.object_name} | ` +
        `${item.status ?? 'pendiente'} | ${item.rows_copied ?? '—'} | ${item.execution_ms ?? '—'} |`,
    )
  }
  lines.push('')

  lines.push('## Todos los pasos')
  lines.push('')
  lines.push('| seq | Tramo | Tipo | Objeto | Estado | Filas | ms | executed_at |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    lines.push(
      `| ${item.seq} | ${item.kind} | ${item.object_type} | ${item.object_name} | ` +
        `${item.status ?? 'pendiente'} | ${item.rows_copied ?? '—'} | ${item.execution_ms ?? '—'} | ` +
        `${item.executed_at ?? '—'} |`,
    )
  }

  return lines.join('\n')
}
