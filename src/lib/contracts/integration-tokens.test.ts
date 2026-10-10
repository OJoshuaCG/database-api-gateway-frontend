import { describe, expect, it } from 'vitest'
import {
  INTEGRATION_DESTRUCTIVE_SCOPES,
  INTEGRATION_SCOPES,
  INTEGRATION_SCOPE_TIERS,
  INTEGRATION_SCOPE_TIER_BY_SCOPE,
  integrationCeilingOutSchema,
  integrationTokenCreateSchema,
  integrationTokenCreatedOutSchema,
  integrationTokenOutSchema,
  integrationTokenUpdateSchema,
  isDestructiveIntegrationScope,
} from './integration-tokens'

const tokenRow = {
  id: 7,
  token_id: 'ab12cd34',
  name: 'web-tienda',
  scopes: ['servers.list'],
  suspended_scopes: [],
  server_ids: [1],
  blueprint_ids: [],
  created_by_admin_id: 3,
  expires_at: '2026-12-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  note: null,
  active: true,
  created_at: '2026-10-10T12:00:00Z',
}

describe('vocabulario de scopes de integración', () => {
  it('son 12 scopes y cada uno tiene un tier conocido', () => {
    expect(INTEGRATION_SCOPES).toHaveLength(12)
    for (const scope of INTEGRATION_SCOPES) {
      expect(INTEGRATION_SCOPE_TIERS).toContain(INTEGRATION_SCOPE_TIER_BY_SCOPE[scope])
    }
  })

  it('los destructivos son exactamente rollback y stamp', () => {
    expect([...INTEGRATION_DESTRUCTIVE_SCOPES].sort()).toEqual([
      'migrations.rollback',
      'migrations.stamp',
    ])
    expect(isDestructiveIntegrationScope('migrations.rollback')).toBe(true)
    expect(isDestructiveIntegrationScope('migrations.stamp')).toBe(true)
    // `apply_forward` es de escritura a propósito: su protección vive en el servidor.
    expect(isDestructiveIntegrationScope('migrations.apply_forward')).toBe(false)
    expect(isDestructiveIntegrationScope('algo.desconocido')).toBe(false)
  })
})

describe('integrationTokenOutSchema', () => {
  it('acepta la fila del backend y conserva los scopes suspendidos', () => {
    const parsed = integrationTokenOutSchema.parse({
      ...tokenRow,
      suspended_scopes: ['migrations.rollback'],
    })
    expect(parsed.suspended_scopes).toEqual(['migrations.rollback'])
    expect(parsed.id).toBe(7)
    expect(parsed.token_id).toBe('ab12cd34')
  })

  it('tolera un backend sin suspended_scopes (lista vacía)', () => {
    const withoutSuspended: Record<string, unknown> = { ...tokenRow }
    delete withoutSuspended.suspended_scopes
    expect(integrationTokenOutSchema.parse(withoutSuspended).suspended_scopes).toEqual([])
  })

  it('NO describe el secreto: el bearer solo existe en la respuesta de alta', () => {
    const parsed = integrationTokenOutSchema.parse({ ...tokenRow, token: 'datumint.x.y' })
    expect('token' in parsed).toBe(false)
  })
})

describe('integrationTokenCreatedOutSchema', () => {
  it('exige el bearer completo', () => {
    expect(integrationTokenCreatedOutSchema.safeParse(tokenRow).success).toBe(false)
    const parsed = integrationTokenCreatedOutSchema.parse({
      ...tokenRow,
      token: 'datumint.ab12cd34.secreto',
    })
    expect(parsed.token).toBe('datumint.ab12cd34.secreto')
  })
})

describe('integrationTokenCreateSchema', () => {
  const valid = {
    name: 'web-tienda',
    scopes: ['servers.list'],
    server_ids: [1],
    blueprint_ids: [],
    expires_in_days: 30,
  }

  it('acepta un alta mínima válida', () => {
    expect(integrationTokenCreateSchema.safeParse(valid).success).toBe(true)
  })

  it('rechaza nombre corto, sin scopes y sin servidores', () => {
    expect(integrationTokenCreateSchema.safeParse({ ...valid, name: 'ab' }).success).toBe(false)
    expect(integrationTokenCreateSchema.safeParse({ ...valid, scopes: [] }).success).toBe(false)
    expect(integrationTokenCreateSchema.safeParse({ ...valid, server_ids: [] }).success).toBe(false)
  })

  it('no acepta campos desconocidos: el servidor usa extra=forbid', () => {
    expect(integrationTokenCreateSchema.safeParse({ ...valid, secret: 'x' }).success).toBe(false)
  })
})

describe('integrationTokenUpdateSchema', () => {
  it('todos los campos son opcionales, pero scopes y servidores no pueden quedar vacíos', () => {
    expect(integrationTokenUpdateSchema.safeParse({}).success).toBe(true)
    expect(integrationTokenUpdateSchema.safeParse({ scopes: [] }).success).toBe(false)
    expect(integrationTokenUpdateSchema.safeParse({ server_ids: [] }).success).toBe(false)
    // La lista de blueprints sí puede vaciarse (solo es obligatoria con scopes destructivos).
    expect(integrationTokenUpdateSchema.safeParse({ blueprint_ids: [] }).success).toBe(true)
  })

  it('no acepta el vencimiento: no se edita', () => {
    expect(integrationTokenUpdateSchema.safeParse({ expires_in_days: 5 }).success).toBe(false)
  })
})

describe('integrationCeilingOutSchema', () => {
  it('parsea el techo con tier por scope y los tres topes de vida', () => {
    const parsed = integrationCeilingOutSchema.parse({
      enabled: true,
      scopes: [
        {
          scope: 'servers.list',
          label: 'Listar servidores permitidos',
          mutates: false,
          tier: 'read',
        },
        {
          scope: 'migrations.rollback',
          label: 'Revertir migraciones',
          mutates: true,
          tier: 'destructive',
        },
      ],
      max_ttl_days: 90,
      max_write_ttl_days: 30,
      max_destructive_ttl_days: 7,
    })
    expect(parsed.scopes[1]?.tier).toBe('destructive')
    expect(parsed.max_destructive_ttl_days).toBe(7)
  })

  it('rechaza un tier que el cliente no conoce', () => {
    const result = integrationCeilingOutSchema.safeParse({
      enabled: true,
      scopes: [{ scope: 'x.y', label: 'X', mutates: true, tier: 'nuclear' }],
      max_ttl_days: 90,
      max_write_ttl_days: 30,
      max_destructive_ttl_days: 7,
    })
    expect(result.success).toBe(false)
  })
})
