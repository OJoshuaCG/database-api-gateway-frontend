import { describe, expect, it } from 'vitest'
import { agentAccessInSchema, managedDatabaseOutSchema } from '.'

const BASE = {
  id: 1,
  name: 'ventas',
  server_id: 2,
  owner_id: 3,
  status: 'active',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
}

describe('managedDatabaseOutSchema — acceso de agentes', () => {
  it('un backend que no manda los flags se lee CERRADO, nunca abierto', () => {
    const parsed = managedDatabaseOutSchema.parse(BASE)
    expect(parsed.agent_access_allowed).toBe(false)
    expect(parsed.agent_access_blocked).toBe(false)
  })

  it('respeta los valores que manda el backend', () => {
    const parsed = managedDatabaseOutSchema.parse({
      ...BASE,
      agent_access_allowed: true,
      agent_access_blocked: true,
    })
    expect(parsed.agent_access_allowed).toBe(true)
    expect(parsed.agent_access_blocked).toBe(true)
  })
})

describe('agentAccessInSchema', () => {
  it('exige los dos campos: el PUT reemplaza el estado completo', () => {
    expect(agentAccessInSchema.safeParse({ allowed: true }).success).toBe(false)
    expect(agentAccessInSchema.safeParse({ blocked: false }).success).toBe(false)
    expect(agentAccessInSchema.safeParse({ allowed: true, blocked: false }).success).toBe(true)
  })
})
