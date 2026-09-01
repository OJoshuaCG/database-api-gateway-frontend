import { describe, expect, it } from 'vitest'
import type { CloneObjectOut, CloneObjectRef, ManagedDatabaseOut, ReconcileDatabaseItem, ServerOut } from '@/lib/contracts'
import {
  INITIAL_PLAN_FORM,
  INITIAL_RULE_SELECTION,
  applyBulkSelection,
  buildCreateCloneBody,
  buildPreviewBody,
  buildStructureSpec,
  canAdoptTarget,
  cloneRefKey,
  countSelectableObjects,
  countSelectedObjects,
  groupObjectsByType,
  isGatewayInternalTable,
  managedDatabasesToSourceOptions,
  parsePatternList,
  portabilityTone,
  reconcileItemsToSourceOptions,
  resolveRuleSelection,
  ruleSelectsEverything,
  selectionPlanKey,
  toggleCloneObjectSelection,
  type PlanFormState,
} from './logic'

function makeServer(overrides: Partial<ServerOut> = {}): ServerOut {
  return {
    id: 1,
    name: 'srv-1',
    host: 'localhost',
    port: 3306,
    engine: 'mysql',
    root_username: 'root',
    status: 'active',
    is_active: true,
    has_root_password: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

function makeManagedDb(overrides: Partial<ManagedDatabaseOut> = {}): ManagedDatabaseOut {
  return {
    id: 7,
    name: 'productos_ref',
    server_id: 1,
    owner_id: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

function makePlan(overrides: Partial<PlanFormState> = {}): PlanFormState {
  return {
    ...INITIAL_PLAN_FORM,
    source: { key: 'managed:7', name: 'productos_ref', serverId: 1, resolvedEngine: 'mysql', managedId: 7, modelId: null },
    targetServerId: 5,
    targetDatabaseName: 'productos_copia',
    ...overrides,
  }
}

describe('managedDatabasesToSourceOptions', () => {
  it('resuelve el motor por join con el servidor cuando la BD no lo expone directo', () => {
    const serverById = new Map([[1, makeServer({ engine: 'postgresql' })]])
    const options = managedDatabasesToSourceOptions([makeManagedDb()], serverById)
    expect(options).toEqual([
      { key: 'managed:7', name: 'productos_ref', serverId: 1, resolvedEngine: 'postgresql', managedId: 7, modelId: null },
    ])
  })
})

describe('reconcileItemsToSourceOptions', () => {
  const items: ReconcileDatabaseItem[] = [
    { name: 'productos_ref', state: 'managed', managed_id: 7 },
    { name: 'legacy_db_09', state: 'unmanaged' },
    { name: 'deleted_elsewhere', state: 'orphan', managed_id: 9 },
  ]

  it('excluye las orphan y cruza el model_id de las que sí están en inventario', () => {
    const options = reconcileItemsToSourceOptions(items, 3, 'mysql', new Map([[7, 42]]))
    expect(options).toHaveLength(2)
    expect(options[0]).toEqual({
      key: 'managed:7',
      name: 'productos_ref',
      serverId: 3,
      resolvedEngine: 'mysql',
      managedId: 7,
      modelId: 42,
    })
    expect(options[1]).toEqual({
      key: 'raw:3:legacy_db_09',
      name: 'legacy_db_09',
      serverId: 3,
      resolvedEngine: 'mysql',
      managedId: null,
      modelId: null,
    })
  })
})

describe('buildCreateCloneBody', () => {
  it('arma el body por database_id cuando el origen es una BD del inventario', () => {
    const body = buildCreateCloneBody(makePlan())
    expect(body).toEqual({
      source_database_id: 7,
      source_server_id: null,
      source_database_name: null,
      target_server_id: 5,
      target_database_name: 'productos_copia',
      target_database_id: null,
      target_mode: 'new',
      include_data: false,
      clean_mode: 'none',
      adopt_target: false,
      adopt_owner_id: null,
      selection: null,
    })
  })

  it('arma el body por server_id+database_name cuando el origen es una BD cruda', () => {
    const plan = makePlan({
      source: { key: 'raw:3:legacy_db_09', name: 'legacy_db_09', serverId: 3, managedId: null, modelId: null },
    })
    const body = buildCreateCloneBody(plan)
    expect(body?.source_database_id).toBeNull()
    expect(body?.source_server_id).toBe(3)
    expect(body?.source_database_name).toBe('legacy_db_09')
  })

  it('nunca manda selection (se resuelve recién en preview)', () => {
    const body = buildCreateCloneBody(makePlan())
    expect(body?.selection).toBeNull()
  })

  it('fuerza clean_mode=none cuando target_mode=new, incluso si el estado local trae otro valor', () => {
    const body = buildCreateCloneBody(makePlan({ targetMode: 'new', cleanMode: 'drop_database' }))
    expect(body?.clean_mode).toBe('none')
  })

  it('usa el nombre de la BD existente elegida cuando target_mode=existing', () => {
    const plan = makePlan({
      targetMode: 'existing',
      cleanMode: 'objects',
      targetExisting: { key: 'managed:9', name: 'productos_db', serverId: 5, managedId: 9, modelId: null },
    })
    const body = buildCreateCloneBody(plan)
    expect(body?.target_database_name).toBe('productos_db')
    expect(body?.target_database_id).toBe(9)
    expect(body?.clean_mode).toBe('objects')
  })

  it('devuelve null si falta el origen o el servidor destino', () => {
    expect(buildCreateCloneBody(makePlan({ source: null }))).toBeNull()
    expect(buildCreateCloneBody(makePlan({ targetServerId: null }))).toBeNull()
    expect(buildCreateCloneBody(makePlan({ targetDatabaseName: '  ' }))).toBeNull()
  })

  it('solo manda adopt_target/adopt_owner_id si adoptTarget está marcado', () => {
    const plan = makePlan({
      source: { key: 'managed:7', name: 'productos_ref', serverId: 1, managedId: 7, modelId: 3 },
      adoptTarget: true,
      adoptOwnerId: 11,
    })
    const body = buildCreateCloneBody(plan)
    expect(body?.adopt_target).toBe(true)
    expect(body?.adopt_owner_id).toBe(11)
  })
})

describe('canAdoptTarget', () => {
  it('requiere clon completo y origen con blueprint', () => {
    const withBlueprint = makePlan({ source: { key: 'managed:7', name: 'x', serverId: 1, managedId: 7, modelId: 3 } })
    expect(canAdoptTarget(withBlueprint, 'complete')).toBe(true)
    expect(canAdoptTarget(withBlueprint, 'partial')).toBe(false)

    const withoutBlueprint = makePlan({ source: { key: 'managed:7', name: 'x', serverId: 1, managedId: 7, modelId: null } })
    expect(canAdoptTarget(withoutBlueprint, 'complete')).toBe(false)
  })
})

describe('selección de objetos', () => {
  const table: CloneObjectRef = { object_type: 'table', name: 'productos' }
  const trigger: CloneObjectRef = { object_type: 'trigger', name: 'trg_audit' }

  it('cloneRefKey identifica de forma única tipo+nombre', () => {
    expect(cloneRefKey(table)).toBe('table:productos')
  })

  it('toggleCloneObjectSelection agrega y quita por key', () => {
    let selection = new Map<string, CloneObjectRef>()
    selection = toggleCloneObjectSelection(selection, table)
    expect(selection.size).toBe(1)
    selection = toggleCloneObjectSelection(selection, trigger)
    expect(selection.size).toBe(2)
    selection = toggleCloneObjectSelection(selection, table)
    expect(selection.has(cloneRefKey(table))).toBe(false)
    expect(selection.has(cloneRefKey(trigger))).toBe(true)
  })
})

describe('groupObjectsByType', () => {
  it('agrupa preservando el orden de aparición', () => {
    const objects: CloneObjectOut[] = [
      { object_type: 'table', name: 'productos', portable: true, portability_reason: null, row_estimate: null },
      { object_type: 'view', name: 'v_catalogo', portable: true, portability_reason: 'best-effort', row_estimate: null },
      { object_type: 'table', name: 'categorias', portable: true, portability_reason: null, row_estimate: null },
    ]
    const groups = groupObjectsByType(objects)
    expect(groups.map((g) => g.objectType)).toEqual(['table', 'view'])
    expect(groups[0]!.objects.map((o) => o.name)).toEqual(['productos', 'categorias'])
  })
})

describe('portabilityTone', () => {
  it('clasifica no portable, best-effort y portable', () => {
    expect(portabilityTone({ object_type: 'routine', name: 'sp', portable: false, portability_reason: 'no portable', row_estimate: null })).toBe('error')
    expect(portabilityTone({ object_type: 'view', name: 'v', portable: true, portability_reason: 'revisar', row_estimate: null })).toBe('warning')
    expect(portabilityTone({ object_type: 'table', name: 't', portable: true, portability_reason: null, row_estimate: null })).toBe('success')
  })
})

// ── Selección declarativa ──────────────────────────────────────────────────────────
function makeObject(overrides: Partial<CloneObjectOut> & Pick<CloneObjectOut, 'name'>): CloneObjectOut {
  return {
    object_type: 'table',
    portable: true,
    portability_reason: null,
    row_estimate: null,
    ...overrides,
  }
}

describe('parsePatternList', () => {
  it('separa por comas y espacios, recorta y descarta vacíos', () => {
    expect(parsePatternList(' fact_*,  dim_* \n log_? ')).toEqual(['fact_*', 'dim_*', 'log_?'])
  })

  it('deduplica preservando el orden y devuelve vacío si no hay nada', () => {
    expect(parsePatternList('a, b, a')).toEqual(['a', 'b'])
    expect(parsePatternList('   ')).toEqual([])
  })
})

describe('buildStructureSpec', () => {
  it('usa SIEMPRE mode=all: con include y names vacío el backend no seleccionaría nada', () => {
    const spec = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 'fact_*' })
    expect(spec.mode).toBe('all')
    expect(spec.names).toEqual([])
    expect(spec.include_patterns).toEqual(['fact_*'])
  })

  it('propaga tipos y patrones de exclusión', () => {
    const spec = buildStructureSpec({
      types: ['table', 'view'],
      includePatterns: '',
      excludePatterns: 'tmp_*, log_*',
    })
    expect(spec.types).toEqual(['table', 'view'])
    expect(spec.exclude_patterns).toEqual(['tmp_*', 'log_*'])
  })
})

describe('ruleSelectsEverything', () => {
  it('es true solo si la regla no recorta nada', () => {
    expect(ruleSelectsEverything(buildStructureSpec(INITIAL_RULE_SELECTION))).toBe(true)
    expect(
      ruleSelectsEverything(buildStructureSpec({ ...INITIAL_RULE_SELECTION, types: ['table'] })),
    ).toBe(false)
    expect(
      ruleSelectsEverything(
        buildStructureSpec({ ...INITIAL_RULE_SELECTION, excludePatterns: 'log_*' }),
      ),
    ).toBe(false)
  })
})

describe('isGatewayInternalTable', () => {
  it('reconoce los dos prefijos de contabilidad interna, sin distinguir mayúsculas', () => {
    expect(isGatewayInternalTable('_gw_v_mi_bd')).toBe(true)
    expect(isGatewayInternalTable('_GW_STG_users')).toBe(true)
    expect(isGatewayInternalTable('gw_ventas')).toBe(false)
    expect(isGatewayInternalTable('')).toBe(false)
  })
})

describe('resolveRuleSelection', () => {
  const catalog: CloneObjectOut[] = [
    makeObject({ name: 'fact_ventas' }),
    makeObject({ name: 'fact_compras' }),
    makeObject({ name: 'dim_cliente' }),
    makeObject({ name: 'log_auditoria' }),
    makeObject({ name: '_gw_v_productos' }),
    makeObject({ name: 'v_resumen', object_type: 'view' }),
  ]

  it('filtra por tipo antes que nada', () => {
    const spec = buildStructureSpec({ ...INITIAL_RULE_SELECTION, types: ['view'] })
    expect(resolveRuleSelection(catalog, spec).map((o) => o.name)).toEqual(['v_resumen'])
  })

  it('excluye siempre la contabilidad interna del gateway', () => {
    const spec = buildStructureSpec(INITIAL_RULE_SELECTION)
    expect(resolveRuleSelection(catalog, spec).map((o) => o.name)).not.toContain('_gw_v_productos')
  })

  it('aplica los patrones de inclusión con comodines', () => {
    const spec = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 'fact_*' })
    expect(resolveRuleSelection(catalog, spec).map((o) => o.name)).toEqual([
      'fact_ventas',
      'fact_compras',
    ])
  })

  it('la exclusión GANA sobre la inclusión', () => {
    const spec = buildStructureSpec({
      ...INITIAL_RULE_SELECTION,
      includePatterns: 'fact_*',
      excludePatterns: '*_compras',
    })
    expect(resolveRuleSelection(catalog, spec).map((o) => o.name)).toEqual(['fact_ventas'])
  })

  it('distingue mayúsculas, como el fnmatchcase del backend', () => {
    const spec = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 'FACT_*' })
    expect(resolveRuleSelection(catalog, spec)).toEqual([])
  })

  it('soporta ? y clases de caracteres', () => {
    const objects = [makeObject({ name: 't1' }), makeObject({ name: 't2' }), makeObject({ name: 'tx' })]
    const single = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 't?' })
    expect(resolveRuleSelection(objects, single)).toHaveLength(3)
    const digits = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 't[0-9]' })
    expect(resolveRuleSelection(objects, digits).map((o) => o.name)).toEqual(['t1', 't2'])
    const negated = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 't[!0-9]' })
    expect(resolveRuleSelection(objects, negated).map((o) => o.name)).toEqual(['tx'])
  })

  it('trata un patrón con un punto como literal, no como comodín de regex', () => {
    const objects = [makeObject({ name: 'a.b' }), makeObject({ name: 'axb' })]
    const spec = buildStructureSpec({ ...INITIAL_RULE_SELECTION, includePatterns: 'a.b' })
    expect(resolveRuleSelection(objects, spec).map((o) => o.name)).toEqual(['a.b'])
  })
})

describe('applyBulkSelection', () => {
  const visible: CloneObjectOut[] = [
    makeObject({ name: 'productos' }),
    makeObject({ name: 'categorias' }),
    makeObject({ name: 'sp_legacy', object_type: 'routine', portable: false }),
  ]

  it('«todo» ignora los no portables', () => {
    const next = applyBulkSelection('all', visible, new Map())
    expect([...next.keys()]).toEqual(['table:productos', 'table:categorias'])
  })

  it('«todo» respeta lo marcado FUERA de la lista visible', () => {
    const previo = new Map<string, CloneObjectRef>([
      ['view:v_oculta', { object_type: 'view', name: 'v_oculta' }],
    ])
    const next = applyBulkSelection('all', visible, previo)
    expect(next.has('view:v_oculta')).toBe(true)
    expect(next.size).toBe(3)
  })

  it('«ninguno» solo quita lo visible', () => {
    const previo = new Map<string, CloneObjectRef>([
      ['table:productos', { object_type: 'table', name: 'productos' }],
      ['view:v_oculta', { object_type: 'view', name: 'v_oculta' }],
    ])
    const next = applyBulkSelection('none', visible, previo)
    expect([...next.keys()]).toEqual(['view:v_oculta'])
  })

  it('«invertir» alterna cada visible portable', () => {
    const previo = new Map<string, CloneObjectRef>([
      ['table:productos', { object_type: 'table', name: 'productos' }],
    ])
    const next = applyBulkSelection('invert', visible, previo)
    expect(next.has('table:productos')).toBe(false)
    expect(next.has('table:categorias')).toBe(true)
  })

  it('los contadores no cuentan los no portables', () => {
    expect(countSelectableObjects(visible)).toBe(2)
    const seleccion = applyBulkSelection('all', visible, new Map())
    expect(countSelectedObjects(visible, seleccion)).toBe(2)
  })
})

describe('buildPreviewBody', () => {
  // El backend valida sobre las claves REALMENTE enviadas: mandar `selection` junto a
  // `structure` —aunque sea `null`— es un 422. Por eso se afirma la AUSENCIA de la clave.
  it('clon completo manda selection: null y ninguna structure', () => {
    const body = buildPreviewBody({ kind: 'full' })
    expect(body).toEqual({ selection: null })
    expect('structure' in body).toBe(false)
  })

  it('selección manual manda las refs y ninguna structure', () => {
    const refs: CloneObjectRef[] = [{ object_type: 'table', name: 'productos' }]
    const body = buildPreviewBody({ kind: 'manual', refs })
    expect(body).toEqual({ selection: refs })
    expect('structure' in body).toBe(false)
  })

  it('regla manda structure y NUNCA la clave selection', () => {
    const structure = buildStructureSpec({ ...INITIAL_RULE_SELECTION, types: ['table'] })
    const body = buildPreviewBody({ kind: 'rule', structure })
    expect(body).toEqual({ structure })
    expect('selection' in body).toBe(false)
  })
})

describe('selectionPlanKey', () => {
  it('es estable ante el orden de las refs marcadas', () => {
    const a: CloneObjectRef = { object_type: 'table', name: 'a' }
    const b: CloneObjectRef = { object_type: 'table', name: 'b' }
    expect(selectionPlanKey({ kind: 'manual', refs: [a, b] })).toBe(
      selectionPlanKey({ kind: 'manual', refs: [b, a] }),
    )
  })

  it('distingue los tres idiomas y dos reglas distintas', () => {
    const soloTablas = buildStructureSpec({ ...INITIAL_RULE_SELECTION, types: ['table'] })
    const soloVistas = buildStructureSpec({ ...INITIAL_RULE_SELECTION, types: ['view'] })
    const claves = new Set([
      selectionPlanKey({ kind: 'full' }),
      selectionPlanKey({ kind: 'manual', refs: [] }),
      selectionPlanKey({ kind: 'rule', structure: soloTablas }),
      selectionPlanKey({ kind: 'rule', structure: soloVistas }),
    ])
    expect(claves.size).toBe(4)
  })
})
