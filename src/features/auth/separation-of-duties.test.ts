import { describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import {
  formatSodInstant,
  ownerOnlyCapabilityIds,
  sodConflictMessage,
  sodConflicts,
  sodSourceLabel,
  sodWarningCopy,
  uncoveredSodConflicts,
} from './separation-of-duties'

/**
 * Espejo de `app/core/separation_of_duties.py` (`conflicts` / `uncovered`): los casos son los del
 * backend, para que el aviso previo diga lo mismo que el 409.
 */
describe('sodConflicts', () => {
  const OWNER_ONLY = ['databases.drop', 'sql_console.execute']

  it('sin security_officer no hay nada que chequear, aunque haya owner y access_admin', () => {
    expect(
      sodConflicts({
        baseRole: 'owner',
        scopeGrants: [{ scopeType: 'server', scopeId: 9, role: 'owner' }],
        globalCapabilities: ['access_admin'],
        capabilityGrants: [{ capability: 'databases.drop', scopeType: 'server', scopeId: 9 }],
        ownerOnlyCapabilities: OWNER_ONLY,
      }),
    ).toEqual([])
  })

  it('security_officer solo, con rol base no owner, no viola nada', () => {
    expect(
      sodConflicts({
        baseRole: 'operator',
        scopeGrants: [{ scopeType: 'environment', scopeId: 3, role: 'operator' }],
        globalCapabilities: ['security_officer'],
      }),
    ).toEqual([])
  })

  it('owner en sus tres formas cuenta para la misma regla, en el orden del backend', () => {
    expect(
      sodConflicts({
        baseRole: 'owner',
        scopeGrants: [
          { scopeType: 'environment', scopeId: 3, role: 'owner' },
          { scopeType: 'server', scopeId: 9, role: 'viewer' },
        ],
        globalCapabilities: ['security_officer'],
        capabilityGrants: [
          { capability: 'databases.drop', scopeType: 'server', scopeId: 9 },
          // No exclusiva de owner: no cuenta.
          { capability: 'databases.write', scopeType: 'server', scopeId: 9 },
        ],
        ownerOnlyCapabilities: OWNER_ONLY,
      }),
    ).toEqual([
      {
        rule: 'owner_security_officer',
        sources: [
          { kind: 'base_role', role: 'owner' },
          { kind: 'scope_grant', scopeType: 'environment', scopeId: 3, role: 'owner' },
          {
            kind: 'capability_grant',
            capability: 'databases.drop',
            scopeType: 'server',
            scopeId: 9,
          },
        ],
      },
    ])
  })

  it('access_admin + security_officer es su propia regla; las dos se ordenan por id como el 409', () => {
    const found = sodConflicts({
      baseRole: 'owner',
      globalCapabilities: ['security_officer', 'access_admin'],
    })
    expect(found.map((conflict) => conflict.rule)).toEqual([
      'access_admin_security_officer',
      'owner_security_officer',
    ])
    expect(found[0]?.sources).toEqual([
      { kind: 'global_capability', globalCapability: 'access_admin' },
    ])
  })

  it('sin catálogo (sin exclusivas de owner) las puntuales no se pueden evaluar', () => {
    expect(
      sodConflicts({
        baseRole: 'viewer',
        globalCapabilities: ['security_officer'],
        capabilityGrants: [{ capability: 'databases.drop', scopeType: 'server', scopeId: 9 }],
      }),
    ).toEqual([])
  })
})

describe('uncoveredSodConflicts', () => {
  it('descarta las reglas que una excepción viva cubre', () => {
    const found = sodConflicts({
      baseRole: 'owner',
      globalCapabilities: ['security_officer', 'access_admin'],
    })
    expect(
      uncoveredSodConflicts(found, ['owner_security_officer']).map((conflict) => conflict.rule),
    ).toEqual(['access_admin_security_officer'])
    expect(
      uncoveredSodConflicts(
        found,
        found.map((conflict) => conflict.rule),
      ),
    ).toEqual([])
  })
})

describe('ownerOnlyCapabilityIds', () => {
  it('son las de owner que operator no tiene (`_OWNER - _OPERATOR`), leídas del catálogo', () => {
    const ids = ownerOnlyCapabilityIds(CATALOG_FIXTURE)
    // Las once de api-reference-v29 §8.1.
    expect([...ids].sort()).toEqual([
      'blueprints.apply',
      'blueprints.captures',
      'clones.execute',
      'collation.execute',
      'databases.drop',
      'engine_users.credentials',
      'engine_users.drop',
      'engine_users.secrets',
      'exports.download',
      'schema_diff.execute',
      'sql_console.execute',
    ])
  })
})

describe('copy de separación de deberes', () => {
  it('nombra cada fuente con el destino y la etiqueta cuando los conoce', () => {
    const options = {
      targetLabel: (type: string, id: number) =>
        type === 'environment' && id === 3 ? 'Producción' : undefined,
      capabilityLabel: (id: string) => (id === 'databases.drop' ? 'Borrar bases' : undefined),
    }
    expect(sodSourceLabel({ kind: 'base_role', role: 'owner' })).toBe('rol base owner')
    expect(
      sodSourceLabel(
        { kind: 'scope_grant', scopeType: 'environment', scopeId: 3, role: 'owner' },
        options,
      ),
    ).toBe('rol owner en el entorno Producción')
    expect(
      sodSourceLabel(
        { kind: 'capability_grant', capability: 'databases.drop', scopeType: 'server', scopeId: 9 },
        options,
      ),
    ).toBe('capacidad puntual «Borrar bases» (databases.drop) en el servidor #9')
    expect(sodSourceLabel({ kind: 'global_capability', globalCapability: 'access_admin' })).toBe(
      'capacidad global Administración de accesos',
    )
    expect(sodSourceLabel({ kind: 'algo_nuevo' })).toBe('algo_nuevo')
  })

  it('el mensaje del rechazo explica la regla en voseo y dice qué choca', () => {
    const message = sodConflictMessage([
      { rule: 'owner_security_officer', sources: [{ kind: 'base_role', role: 'owner' }] },
    ])
    expect(message).toMatch(/^Una misma cuenta no puede ser oficial de seguridad y a la vez owner/)
    expect(message).toContain('Choca: oficial de seguridad y owner (rol base owner).')
    expect(message).toContain('Repartí las funciones')
  })

  it('las fechas UTC sin zona se leen como UTC, no como hora local', () => {
    expect(formatSodInstant('2026-10-02T10:00:00')).toBe(formatSodInstant('2026-10-02T10:00:00Z'))
    expect(formatSodInstant(null)).toBe('—')
  })

  it('cada estado de `sod_warnings` tiene su texto; uno desconocido no se calla', () => {
    const base = { rule: 'owner_security_officer', reason: null, since: null, expires_at: null }
    const grandfathered = sodWarningCopy({ ...base, status: 'grandfathered' })
    expect(grandfathered.tone).toBe('warning')
    expect(grandfathered.body).toContain(
      'Tu cuenta combina funciones que deberían estar separadas (oficial de seguridad y owner).',
    )
    expect(grandfathered.body).toContain('Pedí que se separen')

    const override = sodWarningCopy({
      ...base,
      status: 'override',
      reason: 'Incidente 4711',
      expires_at: '2026-10-03T10:00:00',
    })
    expect(override.body).toContain(formatSodInstant('2026-10-03T10:00:00'))
    expect(override.body).toContain('Incidente 4711')

    const neutralized = sodWarningCopy({ ...base, status: 'neutralized' })
    expect(neutralized.tone).toBe('danger')
    expect(neutralized.title).toBe('Tus funciones de oficial de seguridad están desactivadas')

    expect(sodWarningCopy({ ...base, status: 'nuevo' }).body).toContain('Pedí que se separen')
  })
})
