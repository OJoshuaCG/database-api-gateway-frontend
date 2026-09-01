import { describe, expect, it } from 'vitest'
import type { ReconcileDatabaseItem } from '@/lib/contracts'
import {
  applyAffixToRows,
  buildCreateBatchBody,
  clonableDatabases,
  completedCount,
  duplicateTargetNames,
  INITIAL_BATCH_PLAN,
  patchRow,
  rowsNeedingDataOnly,
  setAllRows,
  toggleRow,
  type BatchPlanState,
  type BatchRowDraft,
} from './logic'

function makeDb(name: string, overrides: Partial<ReconcileDatabaseItem> = {}): ReconcileDatabaseItem {
  return { name, state: 'unmanaged', managed_id: null, ...overrides } as ReconcileDatabaseItem
}

function makeRows(...names: string[]): Map<string, BatchRowDraft> {
  const rows = new Map<string, BatchRowDraft>()
  for (const name of names) {
    rows.set(name, {
      sourceDatabaseName: name,
      sourceDatabaseId: null,
      targetDatabaseName: name,
      targetMode: 'new',
    })
  }
  return rows
}

function makePlan(overrides: Partial<BatchPlanState> = {}): BatchPlanState {
  return { ...INITIAL_BATCH_PLAN, sourceServerId: 1, targetServerId: 2, ...overrides }
}

describe('clonableDatabases', () => {
  it('descarta las huérfanas: están en el inventario pero ya no en el motor', () => {
    const items = [makeDb('viva'), makeDb('fantasma', { state: 'orphan' })]
    expect(clonableDatabases(items).map((d) => d.name)).toEqual(['viva'])
  })
})

describe('selección de filas', () => {
  it('toggleRow agrega con el nombre de origen como destino por defecto', () => {
    const rows = toggleRow(new Map(), makeDb('ventas'))
    expect(rows.get('ventas')?.targetDatabaseName).toBe('ventas')
    expect(rows.get('ventas')?.targetMode).toBe('new')
    expect(toggleRow(rows, makeDb('ventas')).size).toBe(0)
  })

  it('toggleRow conserva el id del inventario cuando la base está adoptada', () => {
    const rows = toggleRow(new Map(), makeDb('ventas', { state: 'managed', managed_id: 7 }))
    expect(rows.get('ventas')?.sourceDatabaseId).toBe(7)
  })

  it('setAllRows no pisa el nombre destino ya editado de una fila marcada', () => {
    let rows = makeRows('a')
    rows = patchRow(rows, 'a', { targetDatabaseName: 'a_renombrada' })
    rows = setAllRows(rows, [makeDb('a'), makeDb('b')], true)
    expect(rows.get('a')?.targetDatabaseName).toBe('a_renombrada')
    expect(rows.get('b')?.targetDatabaseName).toBe('b')
  })

  it('setAllRows con false limpia la selección entera', () => {
    expect(setAllRows(makeRows('a', 'b'), [makeDb('a')], false).size).toBe(0)
  })
})

describe('applyAffixToRows', () => {
  it('aplica prefijo y sufijo', () => {
    const rows = applyAffixToRows(makeRows('ventas'), { prefix: 'stg_', suffix: '_v2' })
    expect(rows.get('ventas')?.targetDatabaseName).toBe('stg_ventas_v2')
  })

  it('parte SIEMPRE del nombre de origen, así que aplicarlo dos veces no acumula', () => {
    let rows = applyAffixToRows(makeRows('ventas'), { prefix: 'stg_', suffix: '' })
    rows = applyAffixToRows(rows, { prefix: 'stg_', suffix: '' })
    expect(rows.get('ventas')?.targetDatabaseName).toBe('stg_ventas')
  })

  it('con prefijo y sufijo vacíos devuelve el nombre de origen', () => {
    let rows = patchRow(makeRows('ventas'), 'ventas', { targetDatabaseName: 'otro' })
    rows = applyAffixToRows(rows, { prefix: '', suffix: '' })
    expect(rows.get('ventas')?.targetDatabaseName).toBe('ventas')
  })
})

describe('validaciones en vivo', () => {
  it('duplicateTargetNames detecta dos filas hacia el mismo destino', () => {
    const rows = patchRow(makeRows('a', 'b'), 'b', { targetDatabaseName: 'a' })
    expect([...duplicateTargetNames(rows)]).toEqual(['a'])
  })

  it('rowsNeedingDataOnly señala las filas con destino existente fuera de solo-datos', () => {
    const rows = patchRow(makeRows('a', 'b'), 'b', { targetMode: 'existing' })
    expect(rowsNeedingDataOnly(rows, 'structure_and_data')).toEqual(['b'])
    // Con 'data_only' ese modo SÍ es representable: es la única combinación admitida allá.
    expect(rowsNeedingDataOnly(rows, 'data_only')).toEqual([])
  })
})

describe('buildCreateBatchBody', () => {
  it('devuelve null mientras el plan no sea enviable', () => {
    expect(buildCreateBatchBody(makePlan({ rows: new Map() }))).toBeNull()
    expect(buildCreateBatchBody(makePlan({ sourceServerId: null, rows: makeRows('a') }))).toBeNull()
    const duplicados = patchRow(makeRows('a', 'b'), 'b', { targetDatabaseName: 'a' })
    expect(buildCreateBatchBody(makePlan({ rows: duplicados }))).toBeNull()
    const vacio = patchRow(makeRows('a'), 'a', { targetDatabaseName: '  ' })
    expect(buildCreateBatchBody(makePlan({ rows: vacio }))).toBeNull()
    const noRepresentable = patchRow(makeRows('a'), 'a', { targetMode: 'existing' })
    expect(buildCreateBatchBody(makePlan({ rows: noRepresentable }))).toBeNull()
  })

  it('arma el cuerpo con una fila por base y recorta los nombres', () => {
    const rows = patchRow(makeRows('a'), 'a', { targetDatabaseName: '  copia_a  ' })
    const body = buildCreateBatchBody(makePlan({ rows }))
    expect(body?.rows).toEqual([
      {
        source_database_name: 'a',
        source_database_id: null,
        target_database_name: 'copia_a',
        target_mode: 'new',
        overrides: null,
      },
    ])
  })

  it('data_on_existing SOLO viaja en solo-datos: en los otros modos el backend da 422', () => {
    const rows = patchRow(makeRows('a'), 'a', { targetMode: 'existing' })
    expect(buildCreateBatchBody(makePlan({ rows: makeRows('a') }))?.data_on_existing).toBeNull()
    const soloDatos = buildCreateBatchBody(
      makePlan({ rows, copyIntent: 'data_only', dataOnExisting: 'upsert' }),
    )
    expect(soloDatos?.data_on_existing).toBe('upsert')
  })

  it('no manda structure si la regla no recorta nada', () => {
    const sinRegla = buildCreateBatchBody(makePlan({ rows: makeRows('a') }))
    expect(sinRegla?.structure).toBeNull()

    const conRegla = buildCreateBatchBody(
      makePlan({
        rows: makeRows('a'),
        rule: { types: [], includePatterns: 'fact_*', excludePatterns: '' },
      }),
    )
    expect(conRegla?.structure?.include_patterns).toEqual(['fact_*'])
    // El modo base es 'all': con 'include' y sin names, el backend no seleccionaría nada.
    expect(conRegla?.structure?.mode).toBe('all')
  })
})

describe('completedCount', () => {
  it('cuenta las filas que llegaron a un desenlace, sea cual sea', () => {
    expect(completedCount({ total: 12, succeeded: 3, failed: 1, running: 1, pending: 7 })).toBe(4)
    expect(completedCount({ total: 5, succeeded: 5 })).toBe(5)
    expect(completedCount({})).toBe(0)
  })
})
