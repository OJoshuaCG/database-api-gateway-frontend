import { describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import {
  capabilitiesAt,
  catalogGlobalCapabilities,
  catalogRoles,
  diffCapabilities,
  effectiveRoleAt,
  globalCapabilityIds,
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
    expect(operator).toHaveLength(17)
    expect(owner).toHaveLength(26)
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

describe('resolveEffectiveAccess', () => {
  it('sin permisos: solo el base, sin cruces', () => {
    const resolved = resolveEffectiveAccess(input())
    expect(resolved.grants).toEqual([])
    expect(resolved.overlaps).toEqual([])
    expect(resolved.baseCapabilities).toHaveLength(17)
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
      'collation.execute',
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
})
