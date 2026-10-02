import { describe, expect, it } from 'vitest'
import { DESTRUCTIVE_CAPABILITIES, effectiveAccessSchema } from '@/lib/contracts'
import {
  CATALOG_FIXTURE,
  DESTRUCTIVE_CAPABILITY_IDS,
  GRANTS_CATALOG_FIXTURE,
} from '@/test/fixtures/authz-catalog'
import {
  capabilitiesAt,
  capabilityGrantsFromServer,
  expandGrant,
  explainAccess,
  grantMatches,
  groupProvenance,
  layer1Capabilities,
  provenanceFromServer,
  provenanceLabel,
  type CapabilityGrantInput,
  catalogGlobalCapabilities,
  catalogRoles,
  diffCapabilities,
  effectiveRoleAt,
  globalCapabilityIds,
  isDestructive,
  isEnforcedByScope,
  layer2CapabilityIds,
  lostEnforcementNote,
  mostProtectedEnvironmentId,
  resolveEffectiveAccess,
  roleCapabilityIds,
  sortByRisk,
  type AccessInput,
} from './authz-model'

const catalog = CATALOG_FIXTURE

// Desarrollo (rank 0), staging (1), producción (2). Producción es el más protegido.
const environments = [
  { id: 1, rank: 0 },
  { id: 2, rank: 1 },
  { id: 3, rank: 2 },
]
const PROD = 3
const DEV = 1

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return { catalog, baseRole: 'operator', grants: [], globalCapabilities: [], ...overrides }
}

describe('derivación de roles y globales desde el catálogo', () => {
  it('cada rol incluye al anterior y sale de la columna `roles`', () => {
    const viewer = roleCapabilityIds(catalog, 'viewer')
    const operator = roleCapabilityIds(catalog, 'operator')
    const owner = roleCapabilityIds(catalog, 'owner')
    expect(viewer).toHaveLength(12)
    // 16: desde que `collation.execute` es solo de `owner` (backend c5edee5).
    expect(operator).toHaveLength(16)
    // 27: `engine_users.credentials` es solo de `owner` (elegir una contraseña divulga).
    expect(owner).toHaveLength(27)
    expect(viewer.every((id) => operator.includes(id))).toBe(true)
    expect(operator.every((id) => owner.includes(id))).toBe(true)
    // `owner` NO tiene las tres de política: van en las globales.
    expect(owner).not.toContain('gateway.admin')
    expect(owner).not.toContain('servers.admin')
  })

  it('las globales salen de `global_capabilities`', () => {
    expect(globalCapabilityIds(catalog, 'access_admin')).toEqual(['gateway.admin'])
    expect(globalCapabilityIds(catalog, 'security_officer')).toEqual([
      'servers.admin',
      'catalogs.write',
      'environments.write',
      'gateway.admin',
    ])
    expect(catalogRoles(catalog)).toEqual(['viewer', 'operator', 'owner'])
    expect(catalogGlobalCapabilities(catalog)).toEqual(['access_admin', 'security_officer'])
  })
})

describe('diffCapabilities', () => {
  it('separa lo que se gana de lo que se pierde', () => {
    expect(diffCapabilities(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({
      gained: ['d'],
      lost: ['a'],
    })
    expect(diffCapabilities(['a'], ['a'])).toEqual({ gained: [], lost: [] })
  })

  it('sortByRisk pone primero lo destructivo y después lo que divulga', () => {
    const sorted = sortByRisk(['databases.read', 'exports.download', 'databases.drop'], catalog)
    expect(sorted.map((row) => row.id)).toEqual([
      'databases.drop',
      'exports.download',
      'databases.read',
    ])
  })
})

describe('effectiveRoleAt — espejo de app/core/scope.py', () => {
  it('sin permisos por alcance rige el rol base', () => {
    expect(
      effectiveRoleAt(
        { baseRole: 'operator', grants: [] },
        { serverId: 9, environmentId: PROD },
        environments,
      ),
    ).toBe('operator')
  })

  it('un permiso de entorno MÁS BAJO que el base lo reemplaza en ese entorno, y solo ahí', () => {
    const role = {
      baseRole: 'operator',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: PROD }, environments)).toBe('viewer')
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: DEV }, environments)).toBe(
      'operator',
    )
  })

  it('un permiso de servidor aplica a las bases de ese servidor', () => {
    const role = {
      baseRole: 'viewer',
      grants: [{ scopeType: 'server', scopeId: 9, role: 'owner' }],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: DEV }, environments)).toBe('owner')
    // Fuera de su servidor rige el BASE, nunca el rol unión (el arreglo F-14 del backend).
    expect(effectiveRoleAt(role, { serverId: 4, environmentId: DEV }, environments)).toBe('viewer')
  })

  it('con permiso de entorno Y de servidor sobre el mismo destino gana el más restrictivo', () => {
    const role = {
      baseRole: 'viewer',
      grants: [
        { scopeType: 'environment', scopeId: DEV, role: 'owner' },
        { scopeType: 'server', scopeId: 9, role: 'operator' },
      ],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: DEV }, environments)).toBe(
      'operator',
    )
  })

  it('una base sin clasificar cuenta como el entorno más protegido', () => {
    expect(mostProtectedEnvironmentId(environments)).toBe(PROD)
    // Empate de rango: gana el id mayor, como el `order_by(rank desc, id desc)` del backend.
    expect(
      mostProtectedEnvironmentId([
        { id: 5, rank: 2 },
        { id: 8, rank: 2 },
      ]),
    ).toBe(8)
    const role = {
      baseRole: 'owner',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: null }, environments)).toBe('viewer')
  })

  it('sin servidor ni entorno es una operación global: rige el base', () => {
    // `resolve_environment_id` devuelve `None` sin destino y no inventa el más protegido.
    const role = {
      baseRole: 'owner',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
    }
    expect(effectiveRoleAt(role, { serverId: null, environmentId: null }, environments)).toBe(
      'owner',
    )
  })

  it('sin entornos cargados, una base sin clasificar no matchea ningún permiso de entorno', () => {
    const role = {
      baseRole: 'owner',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
    }
    expect(mostProtectedEnvironmentId([])).toBeNull()
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: null }, [])).toBe('owner')
  })

  it('un permiso con rol desconocido se descarta, como en `get_current_actor`', () => {
    const role = {
      baseRole: 'operator',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'superuser' }],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: PROD }, environments)).toBe(
      'operator',
    )
  })

  it('un permiso de tipo de alcance desconocido se descarta, no se lee como otro tipo', () => {
    const role = {
      baseRole: 'operator',
      grants: [{ scopeType: 'project', scopeId: 9, role: 'viewer' }],
    }
    expect(effectiveRoleAt(role, { serverId: 9, environmentId: PROD }, environments)).toBe(
      'operator',
    )
  })

  it('un rol base desconocido vale `viewer`', () => {
    expect(
      effectiveRoleAt(
        { baseRole: 'superuser', grants: [] },
        { serverId: 9, environmentId: PROD },
        environments,
      ),
    ).toBe('viewer')
  })
})

describe('capacidades por destino', () => {
  it('las capacidades globales no se recortan por alcance', () => {
    const access = input({
      baseRole: 'owner',
      grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
      globalCapabilities: ['security_officer'],
    })
    const atProd = capabilitiesAt(access, { serverId: 9, environmentId: PROD }, environments)
    expect(atProd).toContain('servers.admin')
    expect(atProd).toContain('gateway.admin')
    expect(atProd).not.toContain('databases.drop')
  })

  it('las capacidades de eje global salen del rol unión y no cambian con el alcance', () => {
    const access = input({
      baseRole: 'viewer',
      grants: [{ scopeType: 'environment', scopeId: DEV, role: 'owner' }],
    })
    const resolved = resolveEffectiveAccess(access)
    expect(resolved.unionRole).toBe('owner')
    expect(resolved.globalAxis).toEqual(['self.read', 'catalogs.read', 'environments.read'])
    // En el destino donde rige el base, las de eje global siguen estando.
    const atProd = capabilitiesAt(access, { serverId: 9, environmentId: PROD }, environments)
    expect(atProd).toEqual(expect.arrayContaining(resolved.globalAxis))
  })
})

describe('isDestructive', () => {
  it('con la marca del catálogo decide la marca: son las siete del backend', () => {
    const ids = GRANTS_CATALOG_FIXTURE.filter(isDestructive).map((row) => row.id)
    expect([...ids].sort()).toEqual([...DESTRUCTIVE_CAPABILITY_IDS].sort())
    expect(ids).toContain('collation.execute')
  })

  it('la marca gana sobre la lista del frontend, en los dos sentidos', () => {
    const drop = GRANTS_CATALOG_FIXTURE.find((row) => row.id === 'databases.drop')!
    const write = GRANTS_CATALOG_FIXTURE.find((row) => row.id === 'databases.write')!
    expect(isDestructive({ ...drop, destructive: false })).toBe(false)
    expect(isDestructive({ ...write, destructive: true })).toBe(true)
  })

  it('sin la marca (backend viejo) cae a la lista del frontend, que coincide con el backend', () => {
    expect(CATALOG_FIXTURE.every((row) => row.destructive === null)).toBe(true)
    const ids = CATALOG_FIXTURE.filter(isDestructive).map((row) => row.id)
    expect([...ids].sort()).toEqual([...DESTRUCTIVE_CAPABILITIES].sort())
    expect([...DESTRUCTIVE_CAPABILITIES].sort()).toEqual([...DESTRUCTIVE_CAPABILITY_IDS].sort())
  })
})

describe('resolveEffectiveAccess', () => {
  it('sin permisos: solo el base, sin cruces', () => {
    const resolved = resolveEffectiveAccess(input())
    expect(resolved.grants).toEqual([])
    expect(resolved.overlaps).toEqual([])
    expect(resolved.baseCapabilities).toHaveLength(16)
  })

  it('un permiso más bajo que el base dice qué pierde ahí', () => {
    const resolved = resolveEffectiveAccess(
      input({ grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }] }),
    )
    expect(resolved.grants[0]?.diff.gained).toEqual([])
    expect(resolved.grants[0]?.diff.lost).toEqual([
      'engine_users.write',
      'databases.write',
      'blueprints.write',
      'exports.execute',
    ])
  })

  it('lista el cruce entorno × servidor con el rol más restrictivo', () => {
    const resolved = resolveEffectiveAccess(
      input({
        grants: [
          { scopeType: 'environment', scopeId: PROD, role: 'owner' },
          { scopeType: 'server', scopeId: 9, role: 'viewer' },
        ],
      }),
    )
    expect(resolved.overlaps).toHaveLength(1)
    expect(resolved.overlaps[0]?.role).toBe('viewer')
    expect(resolved.unionRole).toBe('owner')
  })

  it('no cuenta permisos que el backend descarta, ni para la fila ni para el rol unión', () => {
    const resolved = resolveEffectiveAccess(
      input({
        baseRole: 'viewer',
        grants: [
          { scopeType: 'project', scopeId: 1, role: 'owner' },
          { scopeType: 'environment', scopeId: PROD, role: 'superuser' },
        ],
      }),
    )
    expect(resolved.grants).toHaveLength(0)
    expect(resolved.unionRole).toBe('viewer')
  })
})

describe('capacidades con capa 2 (derivadas del catálogo)', () => {
  /*
   * Copia a mano del conjunto que el backend recorta por alcance (backend `scope-enforcement-hardening`,
   * `capability_matrix()`: eje distinto de `global` y sin el rol `viewer`). Es la fuente de verdad del
   * test: si el catálogo cambia, esta lista se actualiza leyendo el backend, no la función.
   */
  const BACKEND_LAYER2 = [
    'engine_users.write',
    'engine_users.drop',
    'engine_users.secrets',
    'engine_users.credentials',
    'databases.write',
    'databases.drop',
    'blueprints.write',
    'blueprints.apply',
    'blueprints.captures',
    'schema_diff.execute',
    'clones.execute',
    'collation.execute',
    'exports.execute',
    'exports.download',
    'sql_console.execute',
  ]

  it('coinciden con el conjunto por alcance que el backend recorta', () => {
    expect([...layer2CapabilityIds(catalog)].sort()).toEqual([...BACKEND_LAYER2].sort())
  })

  it('las lecturas por alcance y las globales no se recortan', () => {
    expect(isEnforcedByScope('databases.drop', catalog)).toBe(true)
    expect(isEnforcedByScope('engine_users.drop', catalog)).toBe(true)
    expect(isEnforcedByScope('exports.execute', catalog)).toBe(true)
    expect(isEnforcedByScope('databases.read', catalog)).toBe(false)
    expect(isEnforcedByScope('environments.write', catalog)).toBe(false)
    expect(isEnforcedByScope('servers.admin', catalog)).toBe(false)
  })

  it('un rol nuevo en el catálogo se refleja sin tocar la lista', () => {
    const extra = { ...catalog[0]!, id: 'x.run', scope_axis: 'server', roles: ['owner'] }
    expect(isEnforcedByScope('x.run', [...catalog, extra])).toBe(true)
  })

  it('lostEnforcementNote calla si todo lo perdido se recorta y avisa si no', () => {
    const labels = (ids: readonly string[]) => [...ids]
    expect(lostEnforcementNote(['databases.drop'], labels, catalog)).toBe('')
    expect(lostEnforcementNote(['servers.admin'], labels, catalog)).toBe(
      ' (no se recorta por alcance)',
    )
    expect(lostEnforcementNote(['databases.drop', 'servers.admin'], labels, catalog)).toBe(
      ' (por alcance solo se recortan: databases.drop; el resto no)',
    )
  })
})

/*
 * Capacidades puntuales: el espejo se prueba con los MISMOS casos que el backend
 * (`tests/test_capability_grant_resolution.py` y `tests/test_effective_access.py`), sobre un
 * catálogo con `grantable`/`sensitive`/`implies` calculados como `capability_catalog.py`.
 */
describe('capacidades puntuales (espejo de capability_resolution.py)', () => {
  const grantsCatalog = GRANTS_CATALOG_FIXTURE
  const APPLY = 'blueprints.apply'
  const EXEC_SQL = 'sql_console.execute'
  const HISTORY = 'sql_console.history'
  const prodTarget = { serverId: 1, environmentId: PROD }
  const devTarget = { serverId: 2, environmentId: DEV }

  const withGrants = (
    capabilityGrants: CapabilityGrantInput[],
    overrides: Partial<AccessInput> = {},
  ): AccessInput => ({
    catalog: grantsCatalog,
    baseRole: 'viewer',
    grants: [],
    globalCapabilities: [],
    capabilityGrants,
    ...overrides,
  })
  const cg = (
    capability: string,
    scopeType: string,
    scopeId: number,
    extra: Partial<CapabilityGrantInput> = {},
  ): CapabilityGrantInput => ({ capability, scopeType, scopeId, ...extra })
  const has = (ids: string[], id: string) => ids.includes(id)

  it('test_expand_adds_the_implied_read_and_nothing_else', () => {
    expect(expandGrant(EXEC_SQL, grantsCatalog)).toEqual([EXEC_SQL, HISTORY])
    // Una lectura no implica nada más que ella misma.
    expect(expandGrant(HISTORY, grantsCatalog)).toEqual([HISTORY])
    // Con un catálogo anterior (sin `implies`) solo queda la propia.
    expect(expandGrant(EXEC_SQL, CATALOG_FIXTURE)).toEqual([EXEC_SQL])
  })

  it('las sensibles son las ocho de `_SENSITIVE_POLICY`, con `engine_users.credentials`', () => {
    const sensitive = grantsCatalog.filter((row) => row.sensitive).map((row) => row.id)
    expect([...sensitive].sort()).toEqual(
      [
        'engine_users.secrets',
        'engine_users.credentials',
        'blueprints.captures',
        'clones.execute',
        'exports.download',
        'sql_console.execute',
        'engine_users.drop',
        'databases.drop',
      ].sort(),
    )
    // Elegir una contraseña trae la lectura de los usuarios del motor, y nada más.
    expect(expandGrant('engine_users.credentials', grantsCatalog)).toEqual([
      'engine_users.credentials',
      'engine_users.read',
    ])
  })

  it('test_r5a: suma a un rol por alcance restrictivo, solo en su alcance', () => {
    const restriction = [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }]
    // Base owner con viewer@prod: en producción solo lee. Sin la puntual, no aplica (control).
    const withoutGrant = withGrants([], { baseRole: 'owner', grants: restriction })
    expect(has(capabilitiesAt(withoutGrant, prodTarget, environments), APPLY)).toBe(false)

    const withGrant = withGrants([cg(APPLY, 'environment', PROD)], {
      baseRole: 'owner',
      grants: restriction,
    })
    expect(has(capabilitiesAt(withGrant, prodTarget, environments), APPLY)).toBe(true)
    // Fuera de su alcance manda el rol base.
    expect(has(capabilitiesAt(withGrant, devTarget, environments), APPLY)).toBe(true)

    // El caso de negocio: viewer de base y una puntual en producción; en desarrollo sigue viewer.
    const viewer = withGrants([cg(APPLY, 'environment', PROD)])
    expect(has(capabilitiesAt(viewer, prodTarget, environments), APPLY)).toBe(true)
    expect(has(capabilitiesAt(viewer, devTarget, environments), APPLY)).toBe(false)
  })

  it('test_r5b: la de servidor y la de entorno se unen', () => {
    const target = { serverId: 5, environmentId: PROD }
    const applies = (grants: CapabilityGrantInput[]) =>
      has(capabilitiesAt(withGrants(grants), target, environments), APPLY)
    expect(applies([cg(APPLY, 'environment', PROD)])).toBe(true)
    expect(applies([cg(APPLY, 'server', 5)])).toBe(true)
    expect(applies([cg(APPLY, 'environment', PROD), cg(APPLY, 'server', 5)])).toBe(true)
    expect(applies([cg(APPLY, 'server', 6)])).toBe(false)
  })

  it('test_r5c: una pendiente no concede nada, ni en la capa 1', () => {
    const pending = withGrants([cg('databases.drop', 'environment', PROD, { status: 'pending' })])
    expect(has(capabilitiesAt(pending, prodTarget, environments), 'databases.drop')).toBe(false)
    expect(has(layer1Capabilities(pending), 'databases.drop')).toBe(false)
    expect(explainAccess(pending).some((row) => row.source === 'capability_grant')).toBe(false)
  })

  it('test_r5d: la capa 1 pasa por unión; la capa 2, solo donde coincide el alcance', () => {
    const viewer = withGrants([cg(APPLY, 'environment', PROD)])
    expect(has(layer1Capabilities(viewer), APPLY)).toBe(true)
    expect(has(capabilitiesAt(viewer, prodTarget, environments), APPLY)).toBe(true)
    expect(has(capabilitiesAt(viewer, devTarget, environments), APPLY)).toBe(false)
  })

  it('test_r5e: una base sin clasificar se resuelve al entorno más protegido', () => {
    const unclassified = { serverId: 1, environmentId: null }
    const inProd = withGrants([cg(APPLY, 'environment', PROD)])
    const inDev = withGrants([cg(APPLY, 'environment', DEV)])
    expect(has(capabilitiesAt(inProd, unclassified, environments), APPLY)).toBe(true)
    expect(has(capabilitiesAt(inDev, unclassified, environments), APPLY)).toBe(false)
  })

  it('test_a_global_target_matches_no_grant', () => {
    const viewer = withGrants([cg(APPLY, 'environment', PROD), cg(APPLY, 'server', 1)])
    const globalTarget = { serverId: null, environmentId: null }
    expect(has(capabilitiesAt(viewer, globalTarget, environments), APPLY)).toBe(false)
    for (const grant of viewer.capabilityGrants ?? []) {
      expect(grantMatches(grant, globalTarget, environments)).toBe(false)
    }
  })

  it('test_an_implied_read_is_effective_at_the_scope_of_the_grant', () => {
    const grant = cg(EXEC_SQL, 'environment', PROD)
    const input = withGrants([grant])
    expect(has(layer1Capabilities(input), HISTORY)).toBe(true)
    expect(expandGrant(grant.capability, grantsCatalog)).toContain(HISTORY)
    expect(grantMatches(grant, prodTarget, environments)).toBe(true)
    expect(grantMatches(grant, devTarget, environments)).toBe(false)
  })

  it('una puntual por servidor vale en el servidor del destino, sea cual sea su entorno', () => {
    const grant = cg(APPLY, 'server', 9)
    expect(grantMatches(grant, { serverId: 9, environmentId: DEV }, environments)).toBe(true)
    expect(grantMatches(grant, { serverId: 9, environmentId: null }, environments)).toBe(true)
    expect(grantMatches(grant, { serverId: 8, environmentId: DEV }, environments)).toBe(false)
  })

  it.each([
    'gateway.admin',
    'environments.write',
    'self.read',
    'no.existe',
    '',
    'BLUEPRINTS_APPLY',
  ])('test_reader_drops_non_grantable_or_unknown_rows: «%s» no acuña nada', (capability) => {
    const base = withGrants([])
    const forged = withGrants([cg(capability, 'environment', PROD)])
    expect(layer1Capabilities(forged)).toEqual(layer1Capabilities(base))
    expect(capabilitiesAt(forged, prodTarget, environments)).toEqual(
      capabilitiesAt(base, prodTarget, environments),
    )
    expect(explainAccess(forged)).toEqual(explainAccess(base))
  })

  it('test_reader_drops_unknown_scope_types_and_non_positive_ids', () => {
    const input = withGrants([
      cg(APPLY, 'global', 1),
      cg(APPLY, 'environment', 0),
      cg(APPLY, 'environment', Number.NaN),
      cg(APPLY, 'server', 3, { grantId: 4 }),
    ])
    const rows = explainAccess(input).filter((row) => row.source === 'capability_grant')
    expect(rows.map((row) => [row.scopeType, row.scopeId, row.grantId])).toEqual(
      expect.arrayContaining([['server', 3, 4]]),
    )
    expect(rows.every((row) => row.scopeType === 'server' && row.scopeId === 3)).toBe(true)
  })

  it('test_layer1_unions_grants_with_the_role', () => {
    const base = withGrants([])
    const con = withGrants([cg(EXEC_SQL, 'server', 9)])
    expect(has(layer1Capabilities(base), EXEC_SQL)).toBe(false)
    expect(has(layer1Capabilities(con), EXEC_SQL)).toBe(true)
    expect(has(layer1Capabilities(con), HISTORY)).toBe(true)
    expect(layer1Capabilities(base).every((id) => has(layer1Capabilities(con), id))).toBe(true)
  })

  it('con un catálogo anterior (nada otorgable) las puntuales no concedan nada', () => {
    const old = withGrants([cg(APPLY, 'environment', PROD)], { catalog: CATALOG_FIXTURE })
    expect(has(layer1Capabilities(old), APPLY)).toBe(false)
    expect(has(capabilitiesAt(old, prodTarget, environments), APPLY)).toBe(false)
  })

  it('las globales y el rol siguen funcionando igual con puntuales presentes', () => {
    const input = withGrants([cg(APPLY, 'environment', PROD)], {
      globalCapabilities: ['access_admin'],
    })
    expect(has(capabilitiesAt(input, devTarget, environments), 'gateway.admin')).toBe(true)
    expect(effectiveRoleAt(input, devTarget, environments)).toBe('viewer')
  })

  describe('procedencia (explainAccess)', () => {
    it.each(['viewer', 'operator', 'owner'])(
      'test_explain_non_inert_entries_equal_the_layer1_set (base %s)',
      (baseRole) => {
        const input = withGrants(
          [
            cg(EXEC_SQL, 'server', 9, { grantId: 7 }),
            cg('gateway.admin', 'server', 9, { grantId: 8 }),
          ],
          {
            baseRole,
            grants: [
              { scopeType: 'environment', scopeId: 3, role: 'owner' },
              { scopeType: 'server', scopeId: 4, role: 'viewer' },
            ],
            globalCapabilities: ['access_admin'],
          },
        )
        const entries = explainAccess(input)
        const fromEntries = new Set(
          entries.filter((row) => !row.inert).map((row) => row.capability),
        )
        expect(fromEntries).toEqual(new Set(layer1Capabilities(input)))
        const grantRows = entries.filter((row) => row.source === 'capability_grant')
        expect(grantRows.map((row) => [row.capability, row.impliedBy])).toEqual([
          [EXEC_SQL, null],
          [HISTORY, EXEC_SQL],
        ])
        // La fila no otorgable (`gateway.admin`) ni aparece como puntual.
        expect(grantRows.every((row) => row.grantId === 7)).toBe(true)
      },
    )

    it('test_explain_marks_grants_of_a_deactivated_user_inert', () => {
      const input = withGrants([cg(APPLY, 'server', 2, { inert: true })])
      const entries = explainAccess(input)
      expect(
        entries.filter((row) => row.source === 'capability_grant').every((row) => row.inert),
      ).toBe(true)
      expect(entries.filter((row) => row.source !== 'capability_grant').some((r) => r.inert)).toBe(
        false,
      )
      // Inerte = sin efecto: ni capa 1 ni capa 2.
      expect(has(layer1Capabilities(input), APPLY)).toBe(false)
      expect(
        has(capabilitiesAt(input, { serverId: 2, environmentId: DEV }, environments), APPLY),
      ).toBe(false)
    })

    it('test_viewer_at_prod_plus_grant_is_attributed_to_the_grant', () => {
      const input = withGrants([cg(APPLY, 'environment', PROD, { grantId: 5 })], {
        grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
      })
      const entries = explainAccess(input)
      expect(entries.filter((row) => row.capability === APPLY)).toEqual([
        {
          capability: APPLY,
          source: 'capability_grant',
          scopeType: 'environment',
          scopeId: PROD,
          grantId: 5,
          impliedBy: null,
          inert: false,
        },
      ])
      // La lectura implícita sale atribuida a la misma puntual, con `impliedBy`…
      const implied = entries.filter(
        (row) => row.capability === 'blueprints.read' && row.source === 'capability_grant',
      )
      expect(implied.map((row) => [row.grantId, row.impliedBy])).toEqual([[5, APPLY]])
      // …y por rol aparece su propia fila: una por fuente.
      expect(
        entries.some(
          (row) =>
            row.capability === 'blueprints.read' &&
            (row.source === 'role' || row.source === 'scoped_role'),
        ),
      ).toBe(true)
    })

    it('test_global_capabilities_and_sources_are_reported', () => {
      const entries = explainAccess(withGrants([], { globalCapabilities: ['access_admin'] }))
      expect(new Set(entries.map((row) => row.source))).toEqual(new Set(['role', 'global']))
      expect(entries.every((row) => !row.inert)).toBe(true)
    })

    it('las etiquetas de fuente son las de la pantalla', () => {
      expect(['role', 'scoped_role', 'global', 'capability_grant'].map(provenanceLabel)).toEqual([
        'Por rol',
        'Rol por alcance',
        'Global',
        'Capacidad puntual',
      ])
      expect(provenanceLabel('otra')).toBe('otra')
    })
  })

  describe('lo que dice el servidor', () => {
    const server = effectiveAccessSchema.parse({
      user_id: 7,
      username: 'destino',
      active: true,
      base_role: 'viewer',
      scope_roles: [
        { scope_type: 'environment', scope_id: PROD, scope_name: 'Producción', role: 'viewer' },
      ],
      global_capabilities: [],
      capabilities: [
        { capability: 'blueprints.read', source: 'role' },
        {
          capability: 'blueprints.read',
          source: 'scoped_role',
          scope_type: 'environment',
          scope_id: PROD,
          scope_name: 'Producción',
        },
        {
          capability: APPLY,
          source: 'capability_grant',
          scope_type: 'environment',
          scope_id: PROD,
          scope_name: 'Producción',
          grant_id: 5,
        },
        {
          capability: 'blueprints.read',
          source: 'capability_grant',
          scope_type: 'environment',
          scope_id: PROD,
          scope_name: 'Producción',
          grant_id: 5,
          implied_by: APPLY,
        },
      ],
      catalog_version: 'v1',
    })

    it('agrupa por fuente: rol, rol por alcance y puntual con su lectura implícita', () => {
      const groups = groupProvenance(provenanceFromServer(server), grantsCatalog)
      expect(groups.map((group) => [group.kind, group.key])).toEqual([
        ['role', 'role'],
        ['scoped_role', `scoped:environment:${PROD}`],
        ['capability_grant', 'grant:5'],
      ])
      const puntual = groups[2]
      expect(puntual?.grantCapability).toBe(APPLY)
      expect(puntual?.capabilities).toEqual(['blueprints.read', APPLY])
      expect(puntual?.impliedBy).toEqual({ 'blueprints.read': APPLY })
      expect(puntual?.inert).toBe(false)
    })

    it('la vista previa recupera las puntuales del servidor sin las lecturas implícitas', () => {
      expect(capabilityGrantsFromServer(server)).toEqual([
        {
          capability: APPLY,
          scopeType: 'environment',
          scopeId: PROD,
          status: 'active',
          grantId: 5,
          targetLabel: 'Producción',
          inert: false,
        },
      ])
    })

    it('el espejo y el servidor agrupan igual lo mismo', () => {
      const mirror = withGrants([cg(APPLY, 'environment', PROD, { grantId: 5 })], {
        grants: [{ scopeType: 'environment', scopeId: PROD, role: 'viewer' }],
      })
      const fromMirror = groupProvenance(explainAccess(mirror), grantsCatalog).find(
        (group) => group.kind === 'capability_grant',
      )
      const fromServer = groupProvenance(provenanceFromServer(server), grantsCatalog).find(
        (group) => group.kind === 'capability_grant',
      )
      expect(fromMirror).toEqual(fromServer)
    })
  })

  it('resolveEffectiveAccess lista las puntuales con lo implícito, y las inertes marcadas', () => {
    const access = resolveEffectiveAccess(
      withGrants([cg(EXEC_SQL, 'server', 9), cg(APPLY, 'server', 2, { inert: true })]),
    )
    expect(access.capabilityGrants.map((row) => [row.grant.capability, row.implied])).toEqual([
      [EXEC_SQL, [HISTORY]],
      [APPLY, ['blueprints.read']],
    ])
    expect(access.capabilityGrants[1]?.grant.inert).toBe(true)
  })
})
