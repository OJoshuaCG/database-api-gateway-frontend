import { describe, expect, it } from 'vitest'
import type { CloneBatchItemOut, CloneBatchOut } from '@/lib/contracts'
import { buildBatchTimeline, formatBatchDiagnosticsReport } from './diagnostics'

function at(second: number): string {
  const s = String(second % 60).padStart(2, '0')
  const m = String(Math.floor(second / 60)).padStart(2, '0')
  return `2026-09-01T10:${m}:${s}`
}

function makeBatch(overrides: Partial<CloneBatchOut> = {}): CloneBatchOut {
  return {
    id: 3,
    source_server_id: 1,
    target_server_id: 2,
    copy_intent: 'structure_and_data',
    data_on_existing: null,
    target_charset: null,
    target_collation: null,
    total: 2,
    confirm_token: 'tok',
    status: 'succeeded',
    cancel_requested: false,
    error: null,
    counts: { total: 2, succeeded: 2 },
    created_by_username: null,
    created_at: at(0),
    expires_at: at(0),
    started_at: at(0),
    finished_at: at(200),
    ...overrides,
  } as CloneBatchOut
}

let nextId = 1
function makeRow(
  seq: number,
  startedSecond: number | null,
  finishedSecond: number | null,
  overrides: Partial<CloneBatchItemOut> = {},
): CloneBatchItemOut {
  return {
    id: nextId++,
    batch_id: 3,
    seq,
    source_database_name: `db${seq}`,
    source_database_id: null,
    target_database_name: `db${seq}_copy`,
    target_mode: 'new',
    clone_job_id: 100 + seq,
    status: 'succeeded',
    phase: 'done',
    progress: null,
    error: null,
    error_code: null,
    reason: null,
    started_at: startedSecond == null ? null : at(startedSecond),
    finished_at: finishedSecond == null ? null : at(finishedSecond),
    ...overrides,
  }
}

describe('buildBatchTimeline', () => {
  it('mide el hueco de la primera fila contra el arranque del LOTE', () => {
    const t = buildBatchTimeline(makeBatch(), [makeRow(1, 30, 90)])

    expect(t.rows[0]!.gapBeforeMs).toBe(30_000)
    expect(t.rows[0]!.durationMs).toBe(60_000)
  })

  it('mide el hueco de cada fila contra el FIN de la anterior: el «esperando turno» real', () => {
    const t = buildBatchTimeline(makeBatch(), [makeRow(1, 0, 60), makeRow(2, 85, 150)])

    expect(t.rows[1]!.gapBeforeMs).toBe(25_000)
    expect(t.gapsMs).toBe(25_000)
  })

  it('ordena por `seq` y no por duración: con otro orden los huecos saldrían negativos', () => {
    // Llegan al revés, como podría devolverlos una consulta ordenada por otra cosa.
    const t = buildBatchTimeline(makeBatch(), [makeRow(2, 70, 150), makeRow(1, 0, 60)])

    expect(t.rows.map((r) => r.seq)).toEqual([1, 2])
    expect(t.rows[1]!.gapBeforeMs).toBe(10_000)
  })

  it('la cola mide del fin de la última fila al fin del lote', () => {
    const t = buildBatchTimeline(makeBatch(), [makeRow(1, 0, 60), makeRow(2, 60, 180)])

    expect(t.tailMs).toBe(20_000)
  })

  it('una fila que no terminó no rompe la cadena del hueco siguiente', () => {
    // La fila 2 quedó sin `finished_at`; el hueco de la 3 se mide contra la 1, que es lo último
    // que sí terminó. Sin este cuidado, la 3 quedaría con hueco nulo y el reparto no cerraría.
    const t = buildBatchTimeline(makeBatch(), [
      makeRow(1, 0, 60),
      makeRow(2, 60, null, { status: 'failed' }),
      makeRow(3, 100, 160),
    ])

    expect(t.rows[1]!.durationMs).toBeNull()
    expect(t.rows[2]!.gapBeforeMs).toBe(40_000)
  })

  it('la suma de las filas es independiente del total, porque el lote corre en serie', () => {
    const t = buildBatchTimeline(makeBatch(), [makeRow(1, 0, 60), makeRow(2, 90, 150)])

    expect(t.totalMs).toBe(200_000)
    expect(t.rowsMs).toBe(120_000)
    expect(t.gapsMs).toBe(30_000)
  })
})

describe('formatBatchDiagnosticsReport', () => {
  it('lleva el `error_code` pero NUNCA el texto del error ni el `reason`', () => {
    const secreto = "You have an error in your SQL syntax near 'DROP TABLE clientes'"
    const rows = [
      makeRow(1, 0, 60, {
        status: 'failed',
        error: secreto,
        error_code: 'CLONE_BATCH_TARGET_EXISTS',
        reason: secreto,
      }),
    ]
    const reporte = formatBatchDiagnosticsReport(makeBatch(), rows)

    expect(reporte).not.toContain(secreto)
    expect(reporte).not.toContain('DROP TABLE clientes')
    expect(reporte).toContain('CLONE_BATCH_TARGET_EXISTS')
  })

  it('incluye el hueco medido por fila, que es lo que el reporte visual no dice', () => {
    const reporte = formatBatchDiagnosticsReport(makeBatch(), [
      makeRow(1, 0, 60),
      makeRow(2, 85, 150),
    ])

    expect(reporte).toContain('Hueco antes')
    expect(reporte).toContain('25000 ms')
  })
})
