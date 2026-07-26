import { describe, expect, it } from 'vitest'
import type {
  ReconcileDatabaseItem,
  RiskFlags,
  SchemaComparisonItemOut,
  SchemaObjectType,
  SchemaChangeType,
} from '@/lib/contracts'
import {
  buildAdoptBody,
  buildCreateComparisonBody,
  buildExecuteBody,
  canCompareEngines,
  compositionRows,
  groupItemsByObjectName,
  groupItemsByOpGroup,
  hasMysqlProceduralRisk,
  isCrossFlavorPair,
  isSafeAdditive,
  managedDatabasesToOptions,
  opGroupObjectNames,
  pendingIndividualReviewIds,
  reconcileItemsToOptions,
  resolveDatabaseEngine,
  resolveEngineFamily,
  resolveShortcutSelection,
  reviewBlockedIds,
  toggleSelectionAtomic,
  unsatisfiedDependencyWarnings,
  type DatabaseSideOption,
} from './logic'

const NO_RISK: RiskFlags = {
  destructive: false,
  lock_heavy: false,
  data_conversion: false,
  needs_review: false,
  requires_individual_review: false,
  cross_flavor_warning: false,
  possible_rename_of: null,
}

function item(
  id: number,
  objectType: SchemaObjectType,
  objectName: string,
  changeType: SchemaChangeType,
  riskFlags: Partial<RiskFlags> = {},
  grouping: { opGroup?: string | null; dependsOn?: string[] } = {},
): SchemaComparisonItemOut {
  return {
    id,
    comparison_id: 1,
    seq: id,
    object_type: objectType,
    object_name: objectName,
    change_type: changeType,
    phase: 1,
    sql: `-- sql ${id}`,
    risk_flags: { ...NO_RISK, ...riskFlags },
    op_group: grouping.opGroup ?? null,
    depends_on: grouping.dependsOn ?? [],
    down_sql: null,
    down_confirmed: false,
    execution_status: null,
    execution_error: null,
    executed_at: null,
  }
}

describe('resolveEngineFamily / canCompareEngines / isCrossFlavorPair', () => {
  it('agrupa mysql y mariadb en la misma familia; postgresql aparte', () => {
    expect(resolveEngineFamily('mysql')).toBe('mysql_mariadb')
    expect(resolveEngineFamily('mariadb')).toBe('mysql_mariadb')
    expect(resolveEngineFamily('postgresql')).toBe('postgresql')
  })

  it('permite mysql<->mariadb pero nunca postgresql con otro motor', () => {
    expect(canCompareEngines('mysql', 'mariadb')).toBe(true)
    expect(canCompareEngines('mysql', 'mysql')).toBe(true)
    expect(canCompareEngines('postgresql', 'postgresql')).toBe(true)
    expect(canCompareEngines('postgresql', 'mysql')).toBe(false)
    expect(canCompareEngines('mysql', 'postgresql')).toBe(false)
  })

  it('marca cross-flavor solo cuando los motores difieren dentro de mysql/mariadb', () => {
    expect(isCrossFlavorPair('mysql', 'mariadb')).toBe(true)
    expect(isCrossFlavorPair('mysql', 'mysql')).toBe(false)
    expect(isCrossFlavorPair('postgresql', 'postgresql')).toBe(false)
  })
})

describe('resolveDatabaseEngine', () => {
  it('usa el campo engine directo si está presente', () => {
    const db = { id: 1, server_id: 9, engine: 'mariadb' } as never
    expect(resolveDatabaseEngine(db, new Map())).toBe('mariadb')
  })

  it('resuelve por join con el servidor si el backend no expone engine', () => {
    const db = { id: 1, server_id: 9 } as never
    const serverById = new Map([[9, { id: 9, engine: 'postgresql' } as never]])
    expect(resolveDatabaseEngine(db, serverById)).toBe('postgresql')
  })
})

describe('compositionRows', () => {
  it('ordena por magnitud total descendente y descarta tipos vacíos', () => {
    const rows = compositionRows({
      table: { new: 1 },
      column: { new: 2, modified: 1, dropped: 1 },
      index: {},
    })
    expect(rows.map((r) => r.objectType)).toEqual(['column', 'table'])
    expect(rows[0]!.total).toBe(4)
  })
})

describe('groupItemsByObjectName', () => {
  it('agrupa preservando el orden de primera aparición', () => {
    const items = [
      item(1, 'column', 'productos.descripcion', 'new'),
      item(2, 'column', 'clientes.rfc', 'dropped'),
      item(3, 'index', 'productos.idx_nombre', 'new'),
    ]
    const groups = groupItemsByObjectName(items)
    expect(groups.map((g) => g.objectName)).toEqual([
      'productos.descripcion',
      'clientes.rfc',
      'productos.idx_nombre',
    ])
    expect(groups[0]!.items).toHaveLength(1)
  })
})

describe('isSafeAdditive / resolveShortcutSelection', () => {
  const items = [
    item(1, 'column', 'a.col', 'new'),
    item(2, 'column', 'b.col', 'new', { needs_review: true }),
    item(3, 'column', 'c.col', 'dropped', { destructive: true }),
    item(4, 'table', 'd', 'modified'),
  ]

  it('un ítem nuevo sin ninguna risk flag es aditivo seguro', () => {
    expect(isSafeAdditive(items[0]!)).toBe(true)
    expect(isSafeAdditive(items[1]!)).toBe(false)
    expect(isSafeAdditive(items[2]!)).toBe(false)
    expect(isSafeAdditive(items[3]!)).toBe(false)
  })

  it('el atajo "todo" selecciona todos los ids', () => {
    expect(resolveShortcutSelection(items, 'all')).toEqual(new Set([1, 2, 3, 4]))
  })

  it('el atajo "ninguno" vacía la selección', () => {
    expect(resolveShortcutSelection(items, 'none')).toEqual(new Set())
  })

  it('el atajo "aditivos seguros" solo incluye ítems isSafeAdditive', () => {
    expect(resolveShortcutSelection(items, 'safeAdditive')).toEqual(new Set([1]))
  })

  it('el atajo "todo" excluye objetos procedurales aún no revisados, y los incluye una vez revisados', () => {
    const withProcedural = [
      ...items,
      item(5, 'routine', 'sp_x', 'new', { requires_individual_review: true }),
    ]
    expect(resolveShortcutSelection(withProcedural, 'all')).toEqual(new Set([1, 2, 3, 4]))
    expect(resolveShortcutSelection(withProcedural, 'all', new Set([5]))).toEqual(new Set([1, 2, 3, 4, 5]))
  })
})

describe('hasMysqlProceduralRisk', () => {
  const items = [item(1, 'routine', 'sp_x', 'new'), item(2, 'table', 't', 'new')]

  it('true solo si hay un procedural seleccionado y el target es mysql/mariadb', () => {
    expect(hasMysqlProceduralRisk(items, new Set([1]), 'mysql')).toBe(true)
    expect(hasMysqlProceduralRisk(items, new Set([1]), 'mariadb')).toBe(true)
    expect(hasMysqlProceduralRisk(items, new Set([2]), 'mysql')).toBe(false)
    expect(hasMysqlProceduralRisk(items, new Set([1]), 'postgresql')).toBe(false)
    expect(hasMysqlProceduralRisk(items, new Set([1]), undefined)).toBe(false)
  })
})

describe('pendingIndividualReviewIds', () => {
  it('lista los procedurales seleccionados que aún no fueron revisados', () => {
    const items = [item(1, 'routine', 'sp_x', 'new', { requires_individual_review: true })]
    expect(pendingIndividualReviewIds(items, new Set([1]), new Set())).toEqual([1])
    expect(pendingIndividualReviewIds(items, new Set([1]), new Set([1]))).toEqual([])
    expect(pendingIndividualReviewIds(items, new Set(), new Set())).toEqual([])
  })
})

// ── Grupos atómicos por op_group (§10.3) ─────────────────────────────────────────
/** Redefinición típica: DROP + CREATE de la misma vista comparten op_group. */
const REDEFINITION = [
  item(1, 'view', 'v_ventas', 'dropped', { destructive: true }, { opGroup: 'view:v_ventas' }),
  item(2, 'view', 'v_ventas', 'new', {}, { opGroup: 'view:v_ventas' }),
  item(3, 'table', 'clientes', 'new', {}, { opGroup: 'table:clientes' }),
  item(4, 'column', 'productos.sku', 'new'),
]

describe('groupItemsByOpGroup / opGroupObjectNames', () => {
  it('agrupa solo los ítems con op_group; los null quedan fuera del índice', () => {
    const groups = groupItemsByOpGroup(REDEFINITION)
    expect([...groups.keys()]).toEqual(['view:v_ventas', 'table:clientes'])
    expect(groups.get('view:v_ventas')!.map((i) => i.id)).toEqual([1, 2])
  })

  it('resuelve un op_group a nombres de objeto únicos, con fallback al id crudo', () => {
    expect(opGroupObjectNames(REDEFINITION, 'view:v_ventas')).toEqual(['v_ventas'])
    expect(opGroupObjectNames(REDEFINITION, 'grupo:desconocido')).toEqual(['grupo:desconocido'])
  })
})

describe('toggleSelectionAtomic', () => {
  it('marcar un ítem de un grupo marca TODO el grupo (DROP + CREATE juntos)', () => {
    expect(toggleSelectionAtomic(REDEFINITION, new Set(), 2)).toEqual(new Set([1, 2]))
  })

  it('desmarcar un ítem de un grupo desmarca TODO el grupo', () => {
    expect(toggleSelectionAtomic(REDEFINITION, new Set([1, 2, 3]), 1)).toEqual(new Set([3]))
  })

  it('un ítem con op_group null se comporta como individual', () => {
    expect(toggleSelectionAtomic(REDEFINITION, new Set(), 4)).toEqual(new Set([4]))
    expect(toggleSelectionAtomic(REDEFINITION, new Set([4]), 4)).toEqual(new Set())
  })

  it('un grupo a medias (estado defensivo) converge al estado del ítem tocado', () => {
    // El ítem 1 está desmarcado: tocarlo SELECCIONA el grupo completo, incluida la otra mitad.
    expect(toggleSelectionAtomic(REDEFINITION, new Set([2]), 1)).toEqual(new Set([1, 2]))
  })

  it('un id fuera del conjunto cargado degrada al toggle individual', () => {
    expect(toggleSelectionAtomic(REDEFINITION, new Set(), 99)).toEqual(new Set([99]))
  })
})

describe('reviewBlockedIds', () => {
  const proceduralGroup = [
    item(1, 'routine', 'sp_x', 'dropped', { requires_individual_review: true }, { opGroup: 'routine:sp_x' }),
    item(2, 'routine', 'sp_x', 'new', { requires_individual_review: true }, { opGroup: 'routine:sp_x' }),
    item(3, 'table', 't', 'new', {}, { opGroup: 'table:t' }),
    item(4, 'routine', 'sp_suelto', 'new', { requires_individual_review: true }),
  ]

  it('bloquea el grupo COMPLETO mientras algún miembro procedural siga sin revisar', () => {
    expect(reviewBlockedIds(proceduralGroup, new Set())).toEqual(new Set([1, 2, 4]))
    // Revisar solo una mitad del grupo NO lo desbloquea (media selección daría 422).
    expect(reviewBlockedIds(proceduralGroup, new Set([1]))).toEqual(new Set([1, 2, 4]))
    expect(reviewBlockedIds(proceduralGroup, new Set([1, 2]))).toEqual(new Set([4]))
  })

  it('para ítems sin grupo mantiene el gate individual original', () => {
    expect(reviewBlockedIds(proceduralGroup, new Set([1, 2, 4]))).toEqual(new Set())
  })
})

describe('resolveShortcutSelection respeta la atomicidad por op_group', () => {
  it('"todo" excluye el grupo COMPLETO si algún miembro procedural no fue revisado', () => {
    const items = [
      item(1, 'routine', 'sp_x', 'dropped', { requires_individual_review: true }, { opGroup: 'g1' }),
      item(2, 'routine', 'sp_x', 'new', {}, { opGroup: 'g1' }),
      item(3, 'table', 't', 'new'),
    ]
    expect(resolveShortcutSelection(items, 'all')).toEqual(new Set([3]))
    expect(resolveShortcutSelection(items, 'all', new Set([1]))).toEqual(new Set([1, 2, 3]))
  })

  it('"aditivos seguros" nunca incluye media redefinición (CREATE sin su DROP)', () => {
    // El CREATE del grupo es aditivo seguro por sí solo, pero su DROP hermano no: incluirlo solo
    // mandaría media selección (422). El grupo entero queda fuera.
    expect(resolveShortcutSelection(REDEFINITION, 'safeAdditive')).toEqual(new Set([3, 4]))
  })
})

describe('unsatisfiedDependencyWarnings', () => {
  const items = [
    item(1, 'table', 'clientes', 'new', {}, { opGroup: 'table:clientes' }),
    item(2, 'foreign_key', 'ventas.fk_cliente', 'new', {}, { opGroup: 'fk:ventas', dependsOn: ['table:clientes'] }),
    item(3, 'view', 'v_ventas', 'new', {}, { opGroup: 'view:v_ventas', dependsOn: ['fk:ventas'] }),
  ]

  it('avisa cuando un ítem seleccionado depende de un grupo NO seleccionado', () => {
    const warnings = unsatisfiedDependencyWarnings(items, new Set([2]))
    expect(warnings).toEqual([
      {
        missingOpGroup: 'table:clientes',
        missingObjectNames: ['clientes'],
        requiredBy: ['ventas.fk_cliente'],
      },
    ])
  })

  it('no avisa si la dependencia también está seleccionada', () => {
    expect(unsatisfiedDependencyWarnings(items, new Set([1, 2]))).toEqual([])
  })

  it('ignora dependencias hacia grupos que no existen entre los ítems cargados', () => {
    const external = [
      item(9, 'view', 'v_x', 'new', {}, { opGroup: 'view:v_x', dependsOn: ['grupo:externo'] }),
    ]
    expect(unsatisfiedDependencyWarnings(external, new Set([9]))).toEqual([])
  })

  it('sin selección no hay avisos', () => {
    expect(unsatisfiedDependencyWarnings(items, new Set())).toEqual([])
  })
})

describe('buildAdoptBody / buildExecuteBody', () => {
  it('recorta nombre/descripción y omite description vacía', () => {
    const body = buildAdoptBody({
      selectedItemIds: [1, 2],
      name: '  Mi versión  ',
      description: '   ',
      executeImmediately: true,
    })
    expect(body).toEqual({
      selected_item_ids: [1, 2],
      name: 'Mi versión',
      execute_immediately: true,
    })
  })

  it('preserva el ORDEN de los ids (resolved_item_ids viene en orden de ejecución) y nunca manda auto_resolve_dependencies', () => {
    const body = buildAdoptBody({
      selectedItemIds: [9, 3, 7],
      name: 'v2',
      description: '',
      executeImmediately: false,
    })
    expect(body.selected_item_ids).toEqual([9, 3, 7])
    expect('auto_resolve_dependencies' in body).toBe(false)
  })

  it('en modo custom incluye selected_item_ids; en otros modos manda null', () => {
    const custom = buildExecuteBody({
      mode: 'custom',
      selectedItemIds: new Set([5]),
      confirmTargetName: 'productos_db',
      confirmToken: 'tok',
    })
    expect(custom.selected_item_ids).toEqual([5])

    const all = buildExecuteBody({
      mode: 'all',
      selectedItemIds: new Set([5]),
      confirmTargetName: 'productos_db',
      confirmToken: 'tok',
    })
    expect(all.selected_item_ids).toBeNull()
  })
})

describe('managedDatabasesToOptions', () => {
  it('mapea cada BD adoptada a una opción managed con su model_id y motor resuelto', () => {
    const db = { id: 12, name: 'productos_db', server_id: 5, model_id: 9 } as never
    const serverById = new Map([[5, { id: 5, engine: 'mysql' } as never]])
    expect(managedDatabasesToOptions([db], serverById)).toEqual([
      {
        key: 'managed:12',
        name: 'productos_db',
        serverId: 5,
        resolvedEngine: 'mysql',
        managedId: 12,
        modelId: 9,
      },
    ])
  })

  it('modelId queda null cuando la BD no tiene blueprint', () => {
    const db = { id: 12, name: 'productos_db', server_id: 5, model_id: null } as never
    expect(managedDatabasesToOptions([db], new Map())[0]!.modelId).toBeNull()
  })
})

describe('reconcileItemsToOptions', () => {
  function reconcileItem(overrides: Partial<ReconcileDatabaseItem>): ReconcileDatabaseItem {
    return { name: 'db', state: 'unmanaged', managed_id: null, owner_id: null, status: null, ...overrides }
  }

  it('excluye las orphan y distingue managed (con model_id cruzado) de unmanaged (cruda)', () => {
    const items = [
      reconcileItem({ name: 'legacy_db_09', state: 'unmanaged' }),
      reconcileItem({ name: 'productos_db', state: 'managed', managed_id: 12 }),
      reconcileItem({ name: 'borrada_del_motor', state: 'orphan', managed_id: 3 }),
    ]
    const modelIdByManagedId = new Map([[12, 9]])
    const options = reconcileItemsToOptions(items, 5, 'mysql', modelIdByManagedId)

    expect(options).toEqual([
      { key: 'raw:5:legacy_db_09', name: 'legacy_db_09', serverId: 5, resolvedEngine: 'mysql', managedId: null, modelId: null },
      { key: 'managed:12', name: 'productos_db', serverId: 5, resolvedEngine: 'mysql', managedId: 12, modelId: 9 },
    ])
  })

  it('una BD managed sin entrada en modelIdByManagedId queda con modelId null (no explota)', () => {
    const items = [reconcileItem({ name: 'x', state: 'managed', managed_id: 99 })]
    const options = reconcileItemsToOptions(items, 5, 'mysql', new Map())
    expect(options[0]!.modelId).toBeNull()
  })
})

describe('buildCreateComparisonBody', () => {
  const managedOption: DatabaseSideOption = {
    key: 'managed:7',
    name: 'productos_ref',
    serverId: 3,
    resolvedEngine: 'mysql',
    managedId: 7,
    modelId: null,
  }
  const rawOption: DatabaseSideOption = {
    key: 'raw:5:legacy_db_09',
    name: 'legacy_db_09',
    serverId: 5,
    resolvedEngine: 'mysql',
    managedId: null,
    modelId: null,
  }

  it('una BD adoptada se manda por database_id', () => {
    expect(buildCreateComparisonBody(managedOption, managedOption)).toEqual({
      source_database_id: 7,
      target_database_id: 7,
    })
  })

  it('una BD cruda se manda por server_id + database_name; los lados son independientes', () => {
    expect(buildCreateComparisonBody(managedOption, rawOption)).toEqual({
      source_database_id: 7,
      target_server_id: 5,
      target_database_name: 'legacy_db_09',
    })
  })
})
