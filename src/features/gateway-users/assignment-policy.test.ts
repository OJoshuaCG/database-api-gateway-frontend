import { describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE, GRANTS_CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import {
  accessElevations,
  isSensitiveCapability,
  needsSecondApprover,
  type AccessStateInput,
} from './assignment-policy'

/*
 * Espejo de `needs_second_approver` / `is_sensitive` (`app/services/capability_catalog.py`) y de
 * `split` (`app/core/assignment_policy.py`), con los mismos casos que el backend describe en
 * api-reference-v29 §9.2–9.3.
 */

/** `_SENSITIVE_POLICY` del backend: las 11 desde C3. */
const SENSITIVE_POLICY = [
  'engine_users.secrets',
  'engine_users.credentials',
  'blueprints.captures',
  'clones.execute',
  'exports.download',
  'sql_console.execute',
  'engine_users.drop',
  'databases.drop',
  'blueprints.apply',
  'schema_diff.execute',
  'collation.execute',
]

describe('needsSecondApprover', () => {
  it('el rol owner eleva; operator y viewer no', () => {
    expect(needsSecondApprover({ role: 'owner' })).toBe(true)
    expect(needsSecondApprover({ role: 'operator' })).toBe(false)
    expect(needsSecondApprover({ role: 'viewer' })).toBe(false)
  })

  it('CUALQUIER global eleva, también una que esta SPA no conoce', () => {
    expect(needsSecondApprover({ globalCapability: 'access_admin' })).toBe(true)
    expect(needsSecondApprover({ globalCapability: 'security_officer' })).toBe(true)
    expect(needsSecondApprover({ globalCapability: 'algo_nuevo' })).toBe(true)
  })

  it('una capacidad puntual eleva si es sensible según el catálogo', () => {
    expect(needsSecondApprover({ capability: 'databases.drop' }, GRANTS_CATALOG_FIXTURE)).toBe(true)
    expect(needsSecondApprover({ capability: 'databases.write' }, GRANTS_CATALOG_FIXTURE)).toBe(
      false,
    )
    // Sin catálogo no se inventa nada: decide el servidor al responder `pending`.
    expect(needsSecondApprover({ capability: 'databases.drop' })).toBe(false)
  })

  it('sin nada que asignar, no eleva', () => {
    expect(needsSecondApprover({})).toBe(false)
  })
})

describe('isSensitiveCapability', () => {
  it('son exactamente las 11 de `_SENSITIVE_POLICY`: otorgables y exclusivas de owner', () => {
    const sensitive = GRANTS_CATALOG_FIXTURE.filter((row) =>
      isSensitiveCapability(row.id, GRANTS_CATALOG_FIXTURE),
    ).map((row) => row.id)
    expect([...sensitive].sort()).toEqual([...SENSITIVE_POLICY].sort())
  })

  it('coincide con el `sensitive` que publica el catálogo (C3)', () => {
    for (const row of GRANTS_CATALOG_FIXTURE) {
      expect(isSensitiveCapability(row.id, GRANTS_CATALOG_FIXTURE)).toBe(row.sensitive)
    }
  })

  it('lo no otorgable (eje global) nunca es sensible, aunque sea exclusivo de owner', () => {
    // El catálogo viejo no publica `grantable`: nada es otorgable, nada es sensible.
    expect(isSensitiveCapability('databases.drop', CATALOG_FIXTURE)).toBe(false)
    expect(isSensitiveCapability('no.existe', GRANTS_CATALOG_FIXTURE)).toBe(false)
  })
})

describe('accessElevations (espejo de `split`)', () => {
  const viewer: AccessStateInput = { baseRole: 'viewer', globalCapabilities: [], scopeGrants: [] }

  it('un cambio sin elevación se aplica entero en el acto', () => {
    expect(
      accessElevations(viewer, {
        baseRole: 'operator',
        globalCapabilities: [],
        scopeGrants: [{ scope_type: 'environment', scope_id: 3, role: 'operator' }],
      }),
    ).toEqual([])
  })

  it('subir el rol base a owner eleva; conservarlo no', () => {
    expect(accessElevations(viewer, { ...viewer, baseRole: 'owner' })).toEqual([
      { kind: 'base_role', role: 'owner' },
    ])
    const owner = { ...viewer, baseRole: 'owner' }
    expect(accessElevations(owner, owner)).toEqual([])
  })

  it('las globales que se AGREGAN elevan, ordenadas; las que se quitan no', () => {
    const actual = { ...viewer, globalCapabilities: ['security_officer'] }
    expect(
      accessElevations(actual, {
        ...viewer,
        globalCapabilities: ['security_officer', 'access_admin'],
      }),
    ).toEqual([{ kind: 'global_capability', global_capability: 'access_admin' }])
    expect(accessElevations(actual, viewer)).toEqual([])
  })

  it('un owner nuevo en un alcance eleva; uno que ya estaba no; bajar nunca', () => {
    const actual: AccessStateInput = {
      ...viewer,
      scopeGrants: [
        { scope_type: 'environment', scope_id: 3, role: 'owner' },
        { scope_type: 'server', scope_id: 9, role: 'operator' },
      ],
    }
    expect(
      accessElevations(actual, {
        ...viewer,
        scopeGrants: [
          { scope_type: 'environment', scope_id: 3, role: 'owner' },
          { scope_type: 'server', scope_id: 9, role: 'owner' },
          { scope_type: 'environment', scope_id: 1, role: 'owner' },
        ],
      }),
    ).toEqual([
      { kind: 'scope_grant', scope_type: 'environment', scope_id: 1, role: 'owner' },
      { kind: 'scope_grant', scope_type: 'server', scope_id: 9, role: 'owner' },
    ])
    expect(
      accessElevations(actual, {
        ...viewer,
        scopeGrants: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
      }),
    ).toEqual([])
  })

  it('junta las tres formas en el orden del backend: base, globales, alcances', () => {
    expect(
      accessElevations(viewer, {
        baseRole: 'owner',
        globalCapabilities: ['access_admin'],
        scopeGrants: [{ scope_type: 'server', scope_id: 2, role: 'owner' }],
      }).map((elevation) => elevation.kind),
    ).toEqual(['base_role', 'global_capability', 'scope_grant'])
  })
})
