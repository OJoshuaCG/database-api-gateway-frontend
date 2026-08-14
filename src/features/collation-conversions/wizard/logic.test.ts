import { describe, expect, it } from 'vitest'
import type {
  CollationConversionItemOut,
  CollationObjectOut,
  CollationObjectRef,
  CollationTableOut,
} from '@/lib/contracts'
import {
  buildExecuteBody,
  buildPreviewBody,
  isDropWithoutCreateFailure,
  isFailedGrantsSkip,
  isFrozenObjectType,
  isSingleDatabaseAlterFailure,
  modeForEngine,
  objectKey,
  preselectObjects,
  preselectTables,
  toggleObjectSelection,
  toggleTableSelection,
} from './logic'

function makeTable(overrides: Partial<CollationTableOut> = {}): CollationTableOut {
  return {
    name: 'productos',
    charset: 'latin1',
    collation: 'latin1_swedish_ci',
    mismatched_columns: 2,
    needs_conversion: true,
    columns: null,
    ...overrides,
  }
}

function makeObject(overrides: Partial<CollationObjectOut> = {}): CollationObjectOut {
  return {
    object_type: 'view',
    name: 'v_catalogo',
    character_set_client: 'latin1',
    collation_connection: 'latin1_swedish_ci',
    database_collation: 'utf8mb4_unicode_ci',
    is_outdated: true,
    ...overrides,
  }
}

function makeItem(overrides: Partial<CollationConversionItemOut> = {}): CollationConversionItemOut {
  return {
    id: 1,
    job_id: 1,
    seq: 1,
    object_type: 'database',
    object_name: 'productos',
    previous_charset: 'latin1',
    previous_collation: 'latin1_swedish_ci',
    status: 'error',
    error: 'falló el ALTER DATABASE',
    grants_captured: null,
    grants_reapplied: null,
    grants_error: null,
    columns_affected: null,
    execution_ms: 12,
    executed_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

describe('modeForEngine', () => {
  it('postgresql es columns; mysql/mariadb son universal', () => {
    expect(modeForEngine('postgresql')).toBe('columns')
    expect(modeForEngine('mysql')).toBe('universal')
    expect(modeForEngine('mariadb')).toBe('universal')
  })
})

describe('isFrozenObjectType', () => {
  it('reconoce los 5 tipos congelados y rechaza el resto', () => {
    expect(isFrozenObjectType('view')).toBe(true)
    expect(isFrozenObjectType('procedure')).toBe(true)
    expect(isFrozenObjectType('table')).toBe(false)
    expect(isFrozenObjectType('sequence')).toBe(false)
  })
})

describe('objectKey', () => {
  it('combina tipo y nombre para distinguir objetos homónimos entre tipos', () => {
    expect(objectKey({ object_type: 'view', name: 'x' })).toBe('view::x')
    expect(objectKey({ object_type: 'procedure', name: 'x' })).toBe('procedure::x')
  })
})

describe('toggleTableSelection', () => {
  it('agrega y quita por nombre de forma inmutable', () => {
    let selected = new Set<string>()
    const withA = toggleTableSelection(selected, 'a')
    expect(withA).not.toBe(selected)
    expect(withA.has('a')).toBe(true)
    selected = withA
    const withoutA = toggleTableSelection(selected, 'a')
    expect(withoutA.has('a')).toBe(false)
  })
})

describe('toggleObjectSelection', () => {
  it('agrega y quita por objectKey de forma inmutable', () => {
    const ref: CollationObjectRef = { object_type: 'view', name: 'v_catalogo' }
    let selected = new Map<string, CollationObjectRef>()
    const withRef = toggleObjectSelection(selected, ref)
    expect(withRef).not.toBe(selected)
    expect(withRef.has(objectKey(ref))).toBe(true)
    selected = withRef
    const withoutRef = toggleObjectSelection(selected, ref)
    expect(withoutRef.has(objectKey(ref))).toBe(false)
  })
})

describe('preselectTables', () => {
  it('preselecciona solo las tablas con needs_conversion', () => {
    const tables = [
      makeTable({ name: 'a', needs_conversion: true }),
      makeTable({ name: 'b', needs_conversion: false }),
      makeTable({ name: 'c', needs_conversion: true }),
    ]
    expect([...preselectTables(tables)]).toEqual(['a', 'c'])
  })
})

describe('preselectObjects', () => {
  it('preselecciona solo los objetos desactualizados de tipo congelado', () => {
    const objects = [
      makeObject({ object_type: 'view', name: 'v1', is_outdated: true }),
      makeObject({ object_type: 'view', name: 'v2', is_outdated: false }),
      makeObject({ object_type: 'procedure', name: 'p1', is_outdated: true }),
    ]
    const result = preselectObjects(objects)
    expect(result.size).toBe(2)
    expect(result.get('view::v1')).toEqual({ object_type: 'view', name: 'v1' })
    expect(result.get('procedure::p1')).toEqual({ object_type: 'procedure', name: 'p1' })
  })

  it('descarta un object_type que no sea de los 5 tipos congelados', () => {
    const objects = [makeObject({ object_type: 'sequence', name: 's1', is_outdated: true })]
    expect(preselectObjects(objects).size).toBe(0)
  })
})

describe('buildPreviewBody', () => {
  it('en modo universal manda tables + objects + include_database_default tal cual', () => {
    const body = buildPreviewBody({
      checkedTables: new Set(['a']),
      checkedObjects: new Map([['view::v1', { object_type: 'view', name: 'v1' }]]),
      includeDatabaseDefault: true,
      mode: 'universal',
      force: false,
    })
    expect(body).toEqual({
      tables: ['a'],
      objects: [{ object_type: 'view', name: 'v1' }],
      include_database_default: true,
      force: false,
    })
  })

  it('en modo columns fuerza objects=[] e include_database_default=false aunque haya selección', () => {
    const body = buildPreviewBody({
      checkedTables: new Set(['a']),
      checkedObjects: new Map([['view::v1', { object_type: 'view', name: 'v1' }]]),
      includeDatabaseDefault: true,
      mode: 'columns',
      force: true,
    })
    expect(body.objects).toEqual([])
    expect(body.include_database_default).toBe(false)
    expect(body.force).toBe(true)
  })
})

describe('buildExecuteBody', () => {
  it('mapea los tres campos tal cual', () => {
    expect(buildExecuteBody({ confirmTargetName: 'productos', confirmToken: 'tok-1', force: true })).toEqual({
      confirm_target_name: 'productos',
      confirm_token: 'tok-1',
      force: true,
    })
  })
})

describe('isSingleDatabaseAlterFailure', () => {
  it('true cuando el único item es el ALTER DATABASE fallido', () => {
    expect(isSingleDatabaseAlterFailure([makeItem()])).toBe(true)
  })

  it('false si hay más de un item, o el tipo/estado no calza', () => {
    expect(isSingleDatabaseAlterFailure([makeItem(), makeItem({ id: 2, seq: 2 })])).toBe(false)
    expect(isSingleDatabaseAlterFailure([makeItem({ object_type: 'table' })])).toBe(false)
    expect(isSingleDatabaseAlterFailure([makeItem({ status: 'ok' })])).toBe(false)
  })
})

describe('isDropWithoutCreateFailure', () => {
  it('reconoce la frase estable, con o sin tilde, case-insensitive', () => {
    expect(isDropWithoutCreateFailure('el DROP se aplicó y el CREATE no pudo ejecutarse.')).toBe(true)
    expect(isDropWithoutCreateFailure('El drop se aplico y el create no.')).toBe(true)
  })

  it('false para null/undefined o un mensaje que no calza', () => {
    expect(isDropWithoutCreateFailure(null)).toBe(false)
    expect(isDropWithoutCreateFailure(undefined)).toBe(false)
    expect(isDropWithoutCreateFailure('error genérico de conexión')).toBe(false)
  })
})

describe('isFailedGrantsSkip', () => {
  it('true solo si status=skipped y grants_error no es null', () => {
    expect(isFailedGrantsSkip({ status: 'skipped', grants_error: 'no se pudieron leer los grants' })).toBe(
      true,
    )
  })

  it('false si es skipped inocuo (sin grants_error) o si no es skipped', () => {
    expect(isFailedGrantsSkip({ status: 'skipped', grants_error: null })).toBe(false)
    expect(isFailedGrantsSkip({ status: 'ok', grants_error: 'x' })).toBe(false)
  })
})
