import { describe, expect, it } from 'vitest'
import {
  adminOutSchema,
  capabilityDescriptorSchema,
  capabilityGrantCreateSchema,
  capabilityGrantSchema,
  effectiveAccessSchema,
  pendingCapabilityGrantSchema,
} from '.'

const grant = {
  id: 5,
  user_id: 7,
  username: 'mlopez',
  capability: 'databases.drop',
  scope_type: 'server',
  scope_id: 3,
  scope_name: 'pg-prod',
  status: 'pending',
  sensitive: true,
  requested_by: { id: 1, username: 'admin' },
  requested_at: '2026-10-01T10:00:00Z',
  decided_by: null,
  decided_at: null,
  expires_at: '2026-10-08T10:00:00Z',
  request_reason: 'Migración del viernes',
  decision_reason: null,
  implies: ['databases.read'],
}

describe('capabilityGrantSchema', () => {
  it('parsea la forma completa del backend', () => {
    const parsed = capabilityGrantSchema.parse(grant)
    expect(parsed.requested_by?.username).toBe('admin')
    expect(parsed.implies).toEqual(['databases.read'])
  })

  it('tolera un estado y una capacidad desconocidos sin romper el listado', () => {
    // El vocabulario lo decide el backend: un `z.enum` duro tiraría la lista entera.
    const parsed = capabilityGrantSchema.parse({
      ...grant,
      status: 'estado_nuevo',
      capability: 'cap.nueva',
    })
    expect(parsed.status).toBe('estado_nuevo')
  })

  it('cae a `implies: []` y acepta omitidos los campos opcionales', () => {
    const parsed = capabilityGrantSchema.parse({
      id: 1,
      user_id: 2,
      capability: 'databases.write',
      scope_type: 'environment',
      scope_id: 1,
      status: 'active',
      sensitive: false,
    })
    expect(parsed.implies).toEqual([])
    expect(parsed.expires_at).toBeUndefined()
  })
})

describe('pendingCapabilityGrantSchema', () => {
  it('exige can_decide y conserva blocked_reason', () => {
    const parsed = pendingCapabilityGrantSchema.parse({
      ...grant,
      can_decide: false,
      blocked_reason: 'access.self_approval_forbidden',
    })
    expect(parsed.can_decide).toBe(false)
    expect(parsed.blocked_reason).toBe('access.self_approval_forbidden')
    expect(pendingCapabilityGrantSchema.safeParse(grant).success).toBe(false)
  })
})

describe('effectiveAccessSchema', () => {
  it('parsea la procedencia y rellena `inert` en false cuando falta', () => {
    const parsed = effectiveAccessSchema.parse({
      user_id: 7,
      username: 'mlopez',
      active: true,
      base_role: 'viewer',
      scope_roles: [{ scope_type: 'environment', scope_id: 3, scope_name: 'prod', role: 'owner' }],
      global_capabilities: [],
      capabilities: [
        { capability: 'databases.read', source: 'role' },
        {
          capability: 'databases.drop',
          source: 'capability_grant',
          scope_type: 'server',
          scope_id: 3,
          scope_name: 'pg-prod',
          grant_id: 5,
          implied_by: null,
          inert: true,
        },
      ],
      catalog_version: 'abc',
    })
    expect(parsed.capabilities[0]?.inert).toBe(false)
    expect(parsed.capabilities[1]?.grant_id).toBe(5)
  })
})

describe('capabilityGrantCreateSchema', () => {
  it('rechaza `global` como tipo de alcance', () => {
    const base = { capability: 'databases.write', scope_id: 1 }
    expect(capabilityGrantCreateSchema.safeParse({ ...base, scope_type: 'server' }).success).toBe(
      true,
    )
    expect(capabilityGrantCreateSchema.safeParse({ ...base, scope_type: 'global' }).success).toBe(
      false,
    )
  })
})

describe('compatibilidad con un backend anterior', () => {
  it('`/auth/me` sin capability_grants cae a []', () => {
    const parsed = adminOutSchema.parse({ id: 1, username: 'admin' })
    expect(parsed.capability_grants).toEqual([])
  })

  it('`/auth/me` con capability_grants las parsea', () => {
    const parsed = adminOutSchema.parse({
      id: 1,
      username: 'admin',
      capability_grants: [
        {
          id: 5,
          capability: 'databases.drop',
          scope_type: 'server',
          scope_id: 3,
          scope_name: 'pg-prod',
          status: 'pending',
          expires_at: '2026-10-08T10:00:00Z',
        },
      ],
    })
    expect(parsed.capability_grants[0]?.status).toBe('pending')
  })

  it('una fila del catálogo sin grantable/sensitive/implies sigue validando con defaults seguros', () => {
    const parsed = capabilityDescriptorSchema.parse({
      id: 'databases.drop',
      module: 'databases',
      level: 'drop',
      label: 'Eliminar bases',
      mutates: true,
      discloses: false,
    })
    expect(parsed.grantable).toBe(false)
    expect(parsed.sensitive).toBe(false)
    expect(parsed.implies).toEqual([])
  })

  it('una fila del catálogo nueva conserva los tres predicados', () => {
    const parsed = capabilityDescriptorSchema.parse({
      id: 'databases.drop',
      module: 'databases',
      level: 'drop',
      label: 'Eliminar bases',
      mutates: true,
      discloses: false,
      grantable: true,
      sensitive: true,
      implies: ['databases.read'],
    })
    expect(parsed).toMatchObject({ grantable: true, sensitive: true, implies: ['databases.read'] })
  })

  it('sin la columna destructive (backend viejo) la marca sale null: «no sé», no «no es»', () => {
    const parsed = capabilityDescriptorSchema.parse({
      id: 'databases.drop',
      module: 'databases',
      level: 'drop',
      label: 'Eliminar bases',
      mutates: true,
      discloses: false,
    })
    expect(parsed.destructive).toBeNull()
  })

  it('conserva destructive cuando el backend lo manda, false incluido, y null sigue siendo null', () => {
    const base = {
      id: 'databases.drop',
      module: 'databases',
      level: 'drop',
      label: 'Eliminar bases',
      mutates: true,
      discloses: false,
    }
    expect(capabilityDescriptorSchema.parse({ ...base, destructive: true }).destructive).toBe(true)
    expect(capabilityDescriptorSchema.parse({ ...base, destructive: false }).destructive).toBe(
      false,
    )
    expect(capabilityDescriptorSchema.parse({ ...base, destructive: null }).destructive).toBeNull()
  })
})
