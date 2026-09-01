import { describe, expect, it } from 'vitest'
import type { CloneItemKind, CloneItemOut, CloneSummaryOut } from '@/lib/contracts'
import { buildCloneDiagnostics, formatCloneDiagnosticsReport } from './diagnostics'

/** Timestamps sin zona, como los manda el backend (`DateTime` naive, `_utcnow()`). */
function at(second: number): string {
  const s = String(second % 60).padStart(2, '0')
  const m = String(Math.floor(second / 60)).padStart(2, '0')
  return `2026-09-01T10:${m}:${s}`
}

function makeJob(overrides: Partial<CloneSummaryOut> = {}): CloneSummaryOut {
  return {
    id: 7,
    source_server_id: 1,
    source_database_name: 'omni',
    source_database_id: null,
    source_engine: 'mariadb',
    target_server_id: 2,
    target_database_name: 'omni_copy',
    target_database_id: null,
    target_engine: 'mariadb',
    target_mode: 'new',
    include_data: true,
    copy_intent: 'structure_and_data',
    clean_mode: 'none',
    adopt_target: false,
    cross_engine: false,
    status: 'succeeded',
    phase: 'done',
    progress: null,
    error: null,
    expired: false,
    created_at: at(0),
    expires_at: at(0),
    started_at: at(0),
    finished_at: at(140),
    ...overrides,
  }
}

let nextId = 1
function makeItem(
  seq: number,
  kind: CloneItemKind,
  executedAtSecond: number | null,
  executionMs: number | null,
  overrides: Partial<CloneItemOut> = {},
): CloneItemOut {
  return {
    id: nextId++,
    job_id: 7,
    seq,
    kind,
    object_type: 'table',
    object_name: `t${seq}`,
    status: 'applied',
    error: null,
    rows_copied: null,
    execution_ms: executionMs,
    executed_at: executedAtSecond == null ? null : at(executedAtSecond),
    ...overrides,
  }
}

describe('buildCloneDiagnostics', () => {
  it('el tiempo previo a la primera fase es el reloj de pared menos lo medido: ahí cae el snapshot', () => {
    // Estructura termina a los 100 s y sus sentencias midieron 10 s en total. El job arrancó en
    // 0, así que 90 s se fueron ANTES de la primera sentencia: snapshot, fingerprint, plan, lock.
    const items = [
      makeItem(1, 'structure', 100, 6000),
      makeItem(2, 'structure', 100, 4000),
    ]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.slices).toHaveLength(1)
    expect(d.slices[0]!.measuredMs).toBe(10_000)
    expect(d.slices[0]!.wallMs).toBe(100_000)
    expect(d.beforeFirstPhaseMs).toBe(90_000)
  })

  it('una misma `kind` que reaparece produce DOS tramos, no uno agrupado', () => {
    // El pipeline emite estructura, después el cuerpo (vistas), y estructura otra vez (FKs).
    const items = [
      makeItem(1, 'structure', 10, 1000),
      makeItem(2, 'data', 60, 2000),
      makeItem(3, 'structure', 90, 3000),
    ]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.slices.map((s) => s.kind)).toEqual(['structure', 'data', 'structure'])
    expect(d.slices.map((s) => s.seqFrom)).toEqual([1, 2, 3])
  })

  it('el reloj de pared de un tramo se mide contra el FIN del anterior', () => {
    const items = [makeItem(1, 'clean', 20, 500), makeItem(2, 'structure', 50, 1000)]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.slices[1]!.wallMs).toBe(30_000)
    expect(d.slices[1]!.unattributedMs).toBe(29_000)
  })

  it('un paso sin `executed_at` no corre el fin del tramo, pero sí cuenta como paso', () => {
    // Un `skipped` por corte de fase nunca se ejecutó: si su timestamp nulo moviera el fin del
    // tramo, el hueco del tramo siguiente saldría inventado.
    const items = [
      makeItem(1, 'structure', 40, 1000),
      makeItem(2, 'structure', null, null, { status: 'skipped' }),
    ]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.slices[0]!.endedAt).toBe(at(40))
    expect(d.slices[0]!.steps).toBe(2)
    expect(d.slices[0]!.skipped).toBe(1)
    expect(d.slices[0]!.stepsWithoutMs).toBe(1)
  })

  it('`unattributedMs` global es el total menos lo medido, que es la pregunta del caso real', () => {
    const items = [makeItem(1, 'structure', 100, 11_000), makeItem(2, 'data', 120, 2000)]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.totalMs).toBe(140_000)
    expect(d.measuredMs).toBe(13_000)
    expect(d.unattributedMs).toBe(127_000)
  })

  it('la cola mide del fin del último tramo al fin del job (adopción y cierre)', () => {
    const items = [makeItem(1, 'structure', 100, 1000)]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.afterLastPhaseMs).toBe(40_000)
  })

  it('suma las filas copiadas del tramo de datos', () => {
    const items = [
      makeItem(1, 'data', 60, 500, { rows_copied: 1200 }),
      makeItem(2, 'data', 60, 700, { rows_copied: 800 }),
    ]
    const d = buildCloneDiagnostics(makeJob(), items)

    expect(d.slices[0]!.rowsCopied).toBe(2000)
  })

  it('sin `finished_at` no inventa un total: devuelve null', () => {
    const d = buildCloneDiagnostics(makeJob({ finished_at: null, status: 'running' }), [
      makeItem(1, 'structure', 10, 1000),
    ])

    expect(d.totalMs).toBeNull()
    expect(d.unattributedMs).toBeNull()
  })

  it('sin pasos no explota y no reporta un tramo fantasma', () => {
    const d = buildCloneDiagnostics(makeJob(), [])

    expect(d.slices).toEqual([])
    expect(d.beforeFirstPhaseMs).toBeNull()
    expect(d.measuredMs).toBe(0)
  })
})

describe('formatCloneDiagnosticsReport', () => {
  it('NUNCA incluye el texto del error del motor, que puede traer host o SQL', () => {
    const secreto = 'Access denied for user root@10.0.0.5 (using password: YES)'
    const items = [
      makeItem(1, 'structure', 10, 1000, { status: 'failed', error: secreto }),
    ]
    const reporte = formatCloneDiagnosticsReport(makeJob({ error: secreto }), items)

    expect(reporte).not.toContain(secreto)
    expect(reporte).not.toContain('10.0.0.5')
    // Pero sí informa que hubo un fallo: ocultar el hecho no protegería nada.
    expect(reporte).toContain('1 fallidos')
    expect(reporte).toContain('con error')
  })

  it('rotula explícitamente el tiempo previo a la primera fase', () => {
    const reporte = formatCloneDiagnosticsReport(makeJob(), [makeItem(1, 'structure', 100, 1000)])

    expect(reporte).toContain('ANTES DE LA 1ª FASE')
    expect(reporte).toContain('99000 ms')
  })

  it('no cuenta dos veces el «sin atribuir» de la primera fase', () => {
    const reporte = formatCloneDiagnosticsReport(makeJob(), [makeItem(1, 'structure', 100, 1000)])

    // La fila del tramo remite a la de arriba en vez de repetir el número.
    expect(reporte).toContain('(arriba)')
  })
})
