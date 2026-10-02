import { describe, expect, it } from 'vitest'
import type { AccessRequest } from '@/lib/contracts'
import { accessRequestDiff } from './access-request-diff'

const label = (type: string, id: number) => `${type} #${id}`

const request: Pick<AccessRequest, 'desired' | 'elevations'> = {
  desired: {
    gateway_role: 'owner',
    global_capabilities: ['access_admin'],
    scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
  },
  elevations: [
    { kind: 'base_role', role: 'owner' },
    { kind: 'global_capability', global_capability: 'access_admin' },
    { kind: 'scope_grant', scope_type: 'environment', scope_id: 3, role: 'owner' },
  ],
}

describe('accessRequestDiff', () => {
  it('contra el estado actual muestra antes → después y marca lo que eleva', () => {
    const diff = accessRequestDiff(
      request,
      {
        gateway_role: 'viewer',
        global_capabilities: [],
        scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
      },
      label,
    )
    expect(diff.rows).toEqual([
      expect.objectContaining({
        subject: 'Rol base',
        before: 'viewer',
        after: 'owner',
        elevated: true,
      }),
      expect.objectContaining({
        subject: 'access_admin',
        before: null,
        after: 'sí',
        elevated: true,
      }),
      expect.objectContaining({
        subject: 'environment #3',
        before: 'viewer',
        after: 'owner',
        elevated: true,
      }),
    ])
    // Lo que no eleva ya se aplicó al pedirla: la diferencia es exactamente la elevación.
    expect(diff.drift).toBe(false)
  })

  it('si el acceso cambió desde el pedido lo marca como probable solicitud vieja', () => {
    const diff = accessRequestDiff(
      request,
      {
        gateway_role: 'viewer',
        // Alguien le agregó un servidor después: aprobar pisaría ese cambio.
        global_capabilities: [],
        scope_grants: [
          { scope_type: 'environment', scope_id: 3, role: 'viewer' },
          { scope_type: 'server', scope_id: 9, role: 'operator' },
        ],
      },
      label,
    )
    const extra = diff.rows.find((row) => row.subject === 'server #9')
    expect(extra).toMatchObject({ before: 'operator', after: null, elevated: false })
    expect(diff.drift).toBe(true)
  })

  it('una elevación que ya no aparece en la diferencia también es drift', () => {
    const diff = accessRequestDiff(
      request,
      {
        gateway_role: 'owner',
        global_capabilities: ['access_admin'],
        scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
      },
      label,
    )
    expect(diff.rows).toHaveLength(1)
    expect(diff.drift).toBe(true)
  })

  it('sin estado actual muestra solo las elevaciones, con el antes desconocido', () => {
    const diff = accessRequestDiff(request, null, label)
    expect(diff.rows.map((row) => [row.subject, row.before, row.after])).toEqual([
      ['Rol base', undefined, 'owner'],
      ['access_admin', undefined, 'sí'],
      ['environment #3', undefined, 'owner'],
    ])
    expect(diff.drift).toBe(false)
  })
})
