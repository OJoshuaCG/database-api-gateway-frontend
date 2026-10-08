import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { server } from '@/test/server'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useSession } from '@/features/auth'
import {
  useApproveCapabilityGrant,
  useCapabilityGrants,
  useCreateCapabilityGrant,
  useCreateCapabilityGrantsBulk,
  useDecideCapabilityGrantsBulk,
  useEffectiveAccess,
  usePendingCapabilityGrants,
  useRejectCapabilityGrant,
  useRevokeCapabilityGrant,
} from './use-capability-grants'

const API = 'http://localhost/api/v1'

const grantFixture = {
  id: 5,
  user_id: 7,
  username: 'mlopez',
  capability: 'databases.drop',
  scope_type: 'server',
  scope_id: 3,
  scope_name: 'pg-prod',
  status: 'active',
  sensitive: false,
  implies: [],
}

function setup(sessionUserId = 1) {
  // La sesión sale de `/auth/me`: el hook compara su id con el de la persona afectada.
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ id: sessionUserId }) })),
  )
  const queryClient: QueryClient = createTestQueryClient()
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  function wrapper({ children }: { children: ReactNode }) {
    return <AllProviders queryClient={queryClient}>{children}</AllProviders>
  }
  return { wrapper, spy }
}

/** Claves invalidadas por la mutación, para afirmar el QUÉ y no el cómo. */
function invalidated(spy: ReturnType<typeof setup>['spy']) {
  return spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey))
}

describe('consultas', () => {
  it('useCapabilityGrants manda el filtro status y devuelve la lista', async () => {
    let url = ''
    server.use(
      http.get(`${API}/gateway-users/7/capability-grants`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ data: [grantFixture] })
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useCapabilityGrants(7, { status: 'active' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(new URL(url).searchParams.get('status')).toBe('active')
    expect(result.current.data?.[0]?.scope_name).toBe('pg-prod')
  })

  it('useCapabilityGrants no pide nada si está deshabilitado', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useCapabilityGrants(7, { enabled: false }), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('usePendingCapabilityGrants trae can_decide y blocked_reason', async () => {
    server.use(
      http.get(`${API}/capability-grants/pending`, () =>
        HttpResponse.json({
          data: [
            {
              ...grantFixture,
              status: 'pending',
              sensitive: true,
              can_decide: false,
              blocked_reason: 'access.self_approval_forbidden',
            },
          ],
        }),
      ),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => usePendingCapabilityGrants(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]?.can_decide).toBe(false)
    expect(result.current.data?.[0]?.blocked_reason).toBe('access.self_approval_forbidden')
  })

  it('useEffectiveAccess parsea la procedencia', async () => {
    server.use(
      http.get(`${API}/gateway-users/7/effective-access`, () =>
        HttpResponse.json({
          data: {
            user_id: 7,
            username: 'mlopez',
            active: true,
            base_role: 'viewer',
            scope_roles: [],
            global_capabilities: [],
            capabilities: [
              {
                capability: 'databases.drop',
                source: 'capability_grant',
                scope_type: 'server',
                scope_id: 3,
                grant_id: 5,
              },
            ],
            catalog_version: 'abc',
          },
        }),
      ),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useEffectiveAccess(7), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.capabilities[0]?.source).toBe('capability_grant')
  })
})

describe('mutaciones', () => {
  it('crear manda el cuerpo y refresca todo el árbol, y /auth/me si es la propia sesión', async () => {
    let body: unknown = null
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: grantFixture }, { status: 201 })
      }),
    )
    const { wrapper, spy } = setup(7)
    const { result } = renderHook(
      () => ({ session: useSession(), create: useCreateCapabilityGrant(7) }),
      { wrapper },
    )
    // Se espera a la sesión: el hook compara su id con el de la persona afectada.
    await waitFor(() => expect(result.current.session.isAuthenticated).toBe(true))
    act(() => {
      result.current.create.mutate({
        capability: 'databases.drop',
        scope_type: 'server',
        scope_id: 3,
      })
    })
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
    expect(body).toEqual({ capability: 'databases.drop', scope_type: 'server', scope_id: 3 })
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.auth.me()))
  })

  it('el alta masiva manda scope_ids al endpoint /bulk e invalida las capacidades', async () => {
    let body: unknown = null
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            data: {
              count: 2,
              pending: false,
              grants: [grantFixture, { ...grantFixture, id: 6, scope_id: 4 }],
            },
          },
          { status: 201 },
        )
      }),
    )
    const { wrapper, spy } = setup(1)
    const { result } = renderHook(() => useCreateCapabilityGrantsBulk(7), { wrapper })
    act(() => {
      result.current.mutate({
        capability: 'databases.drop',
        scope_type: 'server',
        scope_ids: [3, 4],
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({
      capability: 'databases.drop',
      scope_type: 'server',
      scope_ids: [3, 4],
    })
    expect(result.current.data?.count).toBe(2)
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
  })

  it('un 409 del lote expone cada destino fallido en gatewayUserContext', async () => {
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No se otorgó nada.',
              type: 'AppHttpException',
              public_context: {
                code: 'access.grant_bulk_failed',
                failures: [
                  { scope_id: 3, code: 'access.grant_duplicate', message: 'Duplicada.' },
                  { scope_id: 99, code: 'access.grant_scope_not_found', message: 'No existe.' },
                ],
              },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { wrapper } = setup(1)
    const { result } = renderHook(() => useCreateCapabilityGrantsBulk(7), { wrapper })
    act(() => {
      result.current.mutate({
        capability: 'databases.drop',
        scope_type: 'server',
        scope_ids: [3, 99],
      })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const error = toApiError(result.current.error)
    expect(error.code).toBe('access.grant_bulk_failed')
    expect(error.gatewayUserContext?.grantBulkFailures?.map((f) => [f.scopeId, f.code])).toEqual([
      [3, 'access.grant_duplicate'],
      [99, 'access.grant_scope_not_found'],
    ])
  })

  it('no refresca /auth/me cuando la persona afectada no es la de la sesión', async () => {
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants`, () =>
        HttpResponse.json({ data: grantFixture }, { status: 201 }),
      ),
    )
    const { wrapper, spy } = setup(1)
    const { result } = renderHook(
      () => ({ session: useSession(), create: useCreateCapabilityGrant(7) }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.session.isAuthenticated).toBe(true))
    act(() => {
      result.current.create.mutate({
        capability: 'databases.drop',
        scope_type: 'server',
        scope_id: 3,
      })
    })
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
    expect(invalidated(spy)).not.toContain(JSON.stringify(queryKeys.auth.me()))
  })

  it('una solicitud sensible avisa que queda pendiente', async () => {
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants`, () =>
        HttpResponse.json(
          { data: { ...grantFixture, status: 'pending', sensitive: true } },
          { status: 201 },
        ),
      ),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateCapabilityGrant(7), { wrapper })
    act(() => {
      result.current.mutate({ capability: 'databases.drop', scope_type: 'server', scope_id: 3 })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('pending')
  })

  it('revocar usa DELETE y acepta el 200 con la capacidad en el cuerpo', async () => {
    let method = ''
    server.use(
      http.delete(`${API}/gateway-users/7/capability-grants/5`, ({ request }) => {
        method = request.method
        return HttpResponse.json({ data: { ...grantFixture, status: 'revoked' } })
      }),
    )
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useRevokeCapabilityGrant(7), { wrapper })
    act(() => {
      result.current.mutate(5)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(method).toBe('DELETE')
    expect(result.current.data?.status).toBe('revoked')
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
  })

  it('aprobar sin motivo manda {} y con motivo lo recorta', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/capability-grants/5/approve`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: grantFixture })
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useApproveCapabilityGrant(), { wrapper })
    act(() => {
      result.current.mutate({ grantId: 5 })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    act(() => {
      result.current.mutate({ grantId: 5, reason: '  ok para el viernes ' })
    })
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies).toEqual([{}, { reason: 'ok para el viernes' }])
  })

  it('rechazar envía el motivo; un 409 refresca la bandeja', async () => {
    server.use(
      http.post(`${API}/capability-grants/5/reject`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'ya no está pendiente',
              type: 'AppHttpException',
              public_context: { code: 'access.grant_not_pending' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useRejectCapabilityGrant(), { wrapper })
    act(() => {
      result.current.mutate({ grantId: 5, reason: 'no corresponde' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
  })

  it('el alta masiva con varias capacidades manda `capabilities` y expone la capacidad de cada fallo', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(
          {
            detail: {
              msg: 'No se otorgó nada.',
              type: 'AppHttpException',
              public_context: {
                code: 'access.grant_bulk_failed',
                failures: [
                  {
                    scope_id: 3,
                    capability: 'databases.drop',
                    code: 'access.grant_duplicate',
                    message: 'Duplicada.',
                  },
                ],
              },
            },
          },
          { status: 409 },
        )
      }),
    )
    const { wrapper } = setup(1)
    const { result } = renderHook(() => useCreateCapabilityGrantsBulk(7), { wrapper })
    act(() => {
      result.current.mutate({
        capabilities: ['databases.drop', 'databases.write'],
        scope_type: 'server',
        scope_ids: [3],
      })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(bodies).toEqual([
      { capabilities: ['databases.drop', 'databases.write'], scope_type: 'server', scope_ids: [3] },
    ])
    const failures = toApiError(result.current.error).gatewayUserContext?.grantBulkFailures
    expect(failures?.map((f) => [f.capability, f.scopeId, f.code])).toEqual([
      ['databases.drop', 3, 'access.grant_duplicate'],
    ])
  })
})

describe('decisión masiva', () => {
  const decided = { ...grantFixture, id: 5, status: 'active' }

  it('manda decision, ids y el motivo recortado; sin motivo no manda el campo', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/capability-grants/decisions`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({
          data: {
            requested: 2,
            succeeded: 2,
            failed: 0,
            results: [
              { id: 5, ok: true, grant: decided },
              { id: 6, ok: true, grant: { ...decided, id: 6 } },
            ],
          },
          message: '2 de 2 solicitudes aprobadas.',
        })
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useDecideCapabilityGrantsBulk(), { wrapper })
    act(() => {
      result.current.mutate({ decision: 'approve', ids: [5, 6], reason: '  ok para el viernes ' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    act(() => {
      result.current.mutate({ decision: 'reject', ids: [5, 6], reason: '   ' })
    })
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies).toEqual([
      { decision: 'approve', ids: [5, 6], reason: 'ok para el viernes' },
      { decision: 'reject', ids: [5, 6] },
    ])
  })

  it('un 200 con ítems bloqueados es un éxito del hook: el resumen está en results[]', async () => {
    server.use(
      http.post(`${API}/capability-grants/decisions`, () =>
        HttpResponse.json({
          data: {
            requested: 2,
            succeeded: 1,
            failed: 1,
            results: [
              { id: 5, ok: true, grant: decided },
              {
                id: 6,
                ok: false,
                code: 'access.self_approval_forbidden',
                message: 'No podés aprobar lo que pediste.',
              },
            ],
          },
        }),
      ),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useDecideCapabilityGrantsBulk(), { wrapper })
    act(() => {
      result.current.mutate({ decision: 'approve', ids: [5, 6] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.failed).toBe(1)
    expect(result.current.data?.results[1]).toMatchObject({
      ok: false,
      code: 'access.self_approval_forbidden',
    })
  })

  it('invalida el árbol de capacidades y, si decidió a la persona de la sesión, /auth/me', async () => {
    server.use(
      http.post(`${API}/capability-grants/decisions`, () =>
        HttpResponse.json({
          data: {
            requested: 1,
            succeeded: 1,
            failed: 0,
            results: [{ id: 5, ok: true, grant: decided }],
          },
        }),
      ),
    )
    const { wrapper, spy } = setup(7)
    const { result } = renderHook(
      () => ({ session: useSession(), decide: useDecideCapabilityGrantsBulk() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.session.isAuthenticated).toBe(true))
    act(() => {
      result.current.decide.mutate({ decision: 'approve', ids: [5] })
    })
    await waitFor(() => expect(result.current.decide.isSuccess).toBe(true))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.all))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.auth.me()))
  })

  it('si no se decidió ninguna igual refresca la bandeja, que probablemente quedó vieja', async () => {
    server.use(
      http.post(`${API}/capability-grants/decisions`, () =>
        HttpResponse.json({
          data: {
            requested: 1,
            succeeded: 0,
            failed: 1,
            results: [
              {
                id: 5,
                ok: false,
                code: 'access.grant_not_pending',
                message: 'ya no está pendiente',
              },
            ],
          },
        }),
      ),
    )
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useDecideCapabilityGrantsBulk(), { wrapper })
    act(() => {
      result.current.mutate({ decision: 'approve', ids: [5] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidated(spy)).toContain(JSON.stringify(queryKeys.capabilityGrants.pending()))
  })

  it('un error de la llamada entera (403) no se reintenta y queda como error', async () => {
    let calls = 0
    server.use(
      http.post(`${API}/capability-grants/decisions`, () => {
        calls += 1
        return HttpResponse.json(
          {
            detail: {
              msg: 'No tienes permiso.',
              type: 'AppHttpException',
              public_context: { code: 'access.forbidden' },
            },
          },
          { status: 403 },
        )
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useDecideCapabilityGrantsBulk(), { wrapper })
    act(() => {
      result.current.mutate({ decision: 'approve', ids: [5] })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })
})
