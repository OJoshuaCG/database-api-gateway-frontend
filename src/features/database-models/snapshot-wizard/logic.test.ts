import { describe, expect, it } from 'vitest'
import { fromSnapshotInSchema, type DumpStatement } from '@/lib/contracts'
import {
  buildFromSnapshotBody,
  countByType,
  dataCandidates,
  hasNonPortable,
  objectKey,
  parseObjectKey,
  previewVersions,
  resolveSelectedStatements,
  slugify,
  summarizeCounts,
  validateManualLayout,
  type ObjectSelection,
  type SchemaBucketDraft,
  type WizardBodyInput,
} from './logic'

function stmt(
  object_type: DumpStatement['object_type'],
  name: string,
  depends_on: string[] = [],
): DumpStatement {
  return { object_type, name, ddl: `-- ${name}`, depends_on }
}

const STATEMENTS: DumpStatement[] = [
  stmt('table', 'clientes'),
  stmt('table', 'pedidos', ['clientes']),
  stmt('view', 'v_activos', ['clientes']),
  stmt('routine', 'sp_total'),
  stmt('trigger', 'tg_audit', ['pedidos']),
]

const ALL: ObjectSelection = { typeMode: 'all', types: [], excludedObjectKeys: [] }

describe('resolveSelectedStatements', () => {
  it('incluye todo por defecto', () => {
    expect(resolveSelectedStatements(STATEMENTS, ALL)).toHaveLength(5)
  })

  it('modo include respeta solo los tipos elegidos', () => {
    const result = resolveSelectedStatements(STATEMENTS, {
      typeMode: 'include',
      types: ['table'],
      excludedObjectKeys: [],
    })
    expect(result.map((s) => s.name)).toEqual(['clientes', 'pedidos'])
  })

  it('modo exclude quita los tipos procedurales (baseline portable)', () => {
    const result = resolveSelectedStatements(STATEMENTS, {
      typeMode: 'exclude',
      types: ['routine', 'trigger', 'event'],
      excludedObjectKeys: [],
    })
    expect(hasNonPortable(result)).toBe(false)
    expect(result).toHaveLength(3)
  })

  it('aplica la deselección fina por objeto', () => {
    const result = resolveSelectedStatements(STATEMENTS, {
      ...ALL,
      excludedObjectKeys: [objectKey({ object_type: 'table', name: 'pedidos' })],
    })
    expect(result.find((s) => s.name === 'pedidos')).toBeUndefined()
    expect(result).toHaveLength(4)
  })
})

describe('countByType / summarizeCounts / hasNonPortable', () => {
  it('cuenta por tipo', () => {
    expect(countByType(STATEMENTS)).toEqual({ table: 2, view: 1, routine: 1, trigger: 1 })
  })

  it('resume en singular/plural', () => {
    expect(summarizeCounts({ table: 2, view: 1 })).toBe('2 tablas, 1 vista')
    expect(summarizeCounts({})).toBe('sin objetos')
  })

  it('detecta no portabilidad por procedurales', () => {
    expect(hasNonPortable(STATEMENTS)).toBe(true)
    expect(hasNonPortable([stmt('table', 'x')])).toBe(false)
  })
})

describe('previewVersions', () => {
  it('single produce una sola versión', () => {
    const versions = previewVersions(STATEMENTS, 'single', 'Snapshot baseline')
    expect(versions).toHaveLength(1)
    expect(versions[0]?.kind).toBe('schema')
  })

  it('by_class agrupa por clase en orden y oculta vacías', () => {
    const versions = previewVersions(STATEMENTS, 'by_class', 'Snapshot baseline')
    expect(versions.map((v) => v.name)).toEqual(['Tablas e índices', 'Vistas', 'Rutinas', 'Triggers'])
  })

  it('añade versiones de datos al final', () => {
    const versions = previewVersions(STATEMENTS, 'single', 'Snapshot baseline', 2)
    expect(versions).toHaveLength(3)
    expect(versions.filter((v) => v.kind === 'data')).toHaveLength(2)
    expect(versions.at(-1)?.kind).toBe('data')
  })
})

describe('validateManualLayout', () => {
  const selected = [STATEMENTS[0]!, STATEMENTS[1]!, STATEMENTS[2]!] // clientes, pedidos, v_activos

  it('sin problemas cuando todo está asignado en orden válido', () => {
    const buckets: SchemaBucketDraft[] = [
      { id: 'a', name: 'Tablas', objectKeys: ['table:clientes', 'table:pedidos'] },
      { id: 'b', name: 'Vistas', objectKeys: ['view:v_activos'] },
    ]
    expect(validateManualLayout(buckets, selected)).toEqual([])
  })

  it('detecta objetos sin asignar', () => {
    const buckets: SchemaBucketDraft[] = [{ id: 'a', name: 'Tablas', objectKeys: ['table:clientes'] }]
    const problems = validateManualLayout(buckets, selected)
    expect(problems.some((p) => p.reason === 'unassigned_object')).toBe(true)
  })

  it('detecta buckets vacíos y duplicados', () => {
    const buckets: SchemaBucketDraft[] = [
      { id: 'a', name: 'Uno', objectKeys: ['table:clientes', 'table:pedidos', 'view:v_activos'] },
      { id: 'b', name: 'Dos', objectKeys: ['table:clientes'] },
      { id: 'c', name: 'Vacía', objectKeys: [] },
    ]
    const reasons = validateManualLayout(buckets, selected).map((p) => p.reason)
    expect(reasons).toContain('duplicate_assignment')
    expect(reasons).toContain('empty_bucket')
  })

  it('detecta dependencia en versión posterior', () => {
    const buckets: SchemaBucketDraft[] = [
      { id: 'a', name: 'Vistas', objectKeys: ['view:v_activos', 'table:pedidos'] },
      { id: 'b', name: 'Tablas', objectKeys: ['table:clientes'] },
    ]
    const problems = validateManualLayout(buckets, selected)
    expect(problems.some((p) => p.reason === 'dependency_in_later_version')).toBe(true)
  })
})

describe('dataCandidates', () => {
  it('solo tablas cuya estructura está incluida', () => {
    const candidates = dataCandidates(
      [
        { table: 'clientes', estimated_rows: 10, has_primary_key: true },
        { table: 'ausente', estimated_rows: 5, has_primary_key: true },
      ],
      [stmt('table', 'clientes')],
    )
    expect(candidates.map((c) => c.table)).toEqual(['clientes'])
  })

  it('devuelve vacío si table_stats es null', () => {
    expect(dataCandidates(null, STATEMENTS)).toEqual([])
  })
})

describe('buildFromSnapshotBody', () => {
  const base: WizardBodyInput = {
    serverId: 3,
    database: 'ventas',
    name: 'Ventas',
    slug: 'ventas',
    description: '',
    baselineName: 'Snapshot baseline',
    layout: 'single',
    selection: ALL,
    manualBuckets: [],
    dataSelections: [],
    onOversize: 'skip',
    confirmDataRollback: false,
  }

  it('caso express: payload mínimo y válido', () => {
    const body = buildFromSnapshotBody(base)
    expect(body).toEqual({ server_id: 3, database: 'ventas', name: 'Ventas', slug: 'ventas' })
    expect(fromSnapshotInSchema.safeParse(body).success).toBe(true)
  })

  it('emite filtros exclude y datos con rollback', () => {
    const body = buildFromSnapshotBody(
      {
        ...base,
        layout: 'by_class',
        selection: { typeMode: 'exclude', types: ['routine'], excludedObjectKeys: [] },
        dataSelections: [{ table: 'monedas', mode: 'upsert' }],
        confirmDataRollback: true,
      },
    )
    expect(body.layout).toBe('by_class')
    expect(body.exclude_object_types).toEqual(['routine'])
    expect(body.data_tables).toEqual([{ table: 'monedas', mode: 'upsert' }])
    expect(body.confirm_data_rollback).toBe(true)
    expect(fromSnapshotInSchema.safeParse(body).success).toBe(true)
  })

  it('emite manual_layout con buckets de objetos', () => {
    const body = buildFromSnapshotBody(
      {
        ...base,
        layout: 'manual',
        manualBuckets: [
          { id: 'a', name: 'Tablas base', objectKeys: ['table:clientes'] },
          { id: 'b', name: '', objectKeys: ['view:v_activos'] },
        ],
      },
    )
    expect(body.manual_layout).toEqual([
      { name: 'Tablas base', objects: [{ object_type: 'table', name: 'clientes' }] },
      { name: undefined, objects: [{ object_type: 'view', name: 'v_activos' }] },
    ])
    expect(fromSnapshotInSchema.safeParse(body).success).toBe(true)
  })
})

describe('slugify / parseObjectKey', () => {
  it('normaliza a kebab en minúsculas sin acentos', () => {
    expect(slugify('CRM Legacy Ñoño')).toBe('crm-legacy-nono')
  })

  it('parsea claves con nombres que contienen dos puntos', () => {
    expect(parseObjectKey('table:schema:tbl')).toEqual({ object_type: 'table', name: 'schema:tbl' })
  })
})
