import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { server } from '@/test/server'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { queryKeys } from '@/lib/api/query-keys'
import { useSession } from '@/features/auth'
import {
  useApproveCapabilityGrant,
  useCapabilityGrants,
  useCreateCapabilityGrant,
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
})
