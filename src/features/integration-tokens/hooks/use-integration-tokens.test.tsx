import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import {
  useCreateIntegrationToken,
  useIntegrationTokens,
  useRevokeIntegrationToken,
  useUpdateIntegrationToken,
} from './use-integration-tokens'
import { useIntegrationScopeCeiling } from './use-integration-scope-ceiling'

const API = 'http://localhost/api/v1'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const tokenFixture = {
  id: 12,
  token_id: 'k3f9qm2x',
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

const pagination = { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false }

function wrapperWith(queryClient: ReturnType<typeof createTestQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AllProviders queryClient={queryClient}>{children}</AllProviders>
  }
}

describe('useIntegrationTokens', () => {
  it('mapea el listado paginado y distingue id de token_id', async () => {
    server.use(
      http.get(`${API}/integration-tokens`, () =>
        HttpResponse.json({ data: [tokenFixture], pagination }),
      ),
    )
    const { result } = renderHook(() => useIntegrationTokens({ page: 1, size: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.id).toBe(12)
    expect(result.current.data?.items[0]?.token_id).toBe('k3f9qm2x')
  })

  it('con enabled=false no pide el listado', () => {
    let requests = 0
    server.use(
      http.get(`${API}/integration-tokens`, () => {
        requests += 1
        return HttpResponse.json({ data: [], pagination })
      }),
    )
    const { result } = renderHook(() => useIntegrationTokens({ page: 1, size: 20 }, false), {
      wrapper,
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(requests).toBe(0)
  })
})

describe('useIntegrationScopeCeiling', () => {
  it('trae el techo con tier por scope y los tres topes', async () => {
    server.use(
      http.get(`${API}/integration-tokens/ceiling`, () =>
        HttpResponse.json({
          data: {
            enabled: true,
            scopes: [
              { scope: 'servers.list', label: 'Listar', mutates: false, tier: 'read' },
              { scope: 'migrations.stamp', label: 'Marcar', mutates: true, tier: 'destructive' },
            ],
            max_ttl_days: 90,
            max_write_ttl_days: 30,
            max_destructive_ttl_days: 7,
          },
        }),
      ),
    )
    const { result } = renderHook(() => useIntegrationScopeCeiling(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.scopes.map((entry) => entry.tier)).toEqual(['read', 'destructive'])
    expect(result.current.data?.max_destructive_ttl_days).toBe(7)
  })
})

describe('useCreateIntegrationToken', () => {
  it('manda el alta, devuelve el bearer completo e invalida el listado', async () => {
    let received: unknown = null
    server.use(
      http.post(`${API}/integration-tokens`, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json(
          {
            data: { ...tokenFixture, token: 'datumint.k3f9qm2x.secreto' },
            message: 'Token emitido.',
          },
          { status: 201 },
        )
      }),
    )
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateIntegrationToken(), {
      wrapper: wrapperWith(queryClient),
    })
    act(() => {
      result.current.mutate({
        name: 'web-tienda',
        scopes: ['servers.list'],
        server_ids: [1],
        blueprint_ids: [],
        expires_in_days: 90,
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.token).toBe('datumint.k3f9qm2x.secreto')
    expect(received).toEqual({
      name: 'web-tienda',
      scopes: ['servers.list'],
      server_ids: [1],
      blueprint_ids: [],
      expires_in_days: 90,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrationTokens.all })
  })

  it('NO conserva el bearer en la caché de mutaciones (gcTime 0)', async () => {
    server.use(
      http.post(`${API}/integration-tokens`, () =>
        HttpResponse.json(
          { data: { ...tokenFixture, token: 'datumint.k3f9qm2x.secreto' } },
          { status: 201 },
        ),
      ),
    )
    const queryClient = createTestQueryClient()
    const { result, unmount } = renderHook(() => useCreateIntegrationToken(), {
      wrapper: wrapperWith(queryClient),
    })
    act(() => {
      result.current.mutate({ name: 'web-tienda', scopes: ['servers.list'], server_ids: [1] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    unmount()
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
  })

  it('un 422 de blueprint obligatorio falla y no deja un token a medias en el listado', async () => {
    server.use(
      http.post(`${API}/integration-tokens`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Falta la lista de blueprints.',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.blueprint_allowlist_required' },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const { result } = renderHook(() => useCreateIntegrationToken(), { wrapper })
    act(() => {
      result.current.mutate({
        name: 'web-tienda',
        scopes: ['migrations.rollback'],
        server_ids: [1],
      })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toApiError(result.current.error).code).toBe(
      'integration_token.blueprint_allowlist_required',
    )
  })
})

describe('useUpdateIntegrationToken', () => {
  it('manda PATCH a la PK numérica con el cuerpo recibido e invalida el listado', async () => {
    let calledPath: string | null = null
    let received: unknown = null
    server.use(
      http.patch(`${API}/integration-tokens/:pk`, async ({ params, request }) => {
        calledPath = String(params.pk)
        received = await request.json()
        return HttpResponse.json({
          data: { ...tokenFixture, scopes: ['servers.list', 'databases.create'] },
        })
      }),
    )
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateIntegrationToken(), {
      wrapper: wrapperWith(queryClient),
    })
    act(() => {
      result.current.mutate({
        tokenPk: 12,
        body: { scopes: ['servers.list', 'databases.create'] },
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calledPath).toBe('12')
    expect(received).toEqual({ scopes: ['servers.list', 'databases.create'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrationTokens.all })
  })

  it('un 422 ttl_too_long deja pasar el max_days en el error', async () => {
    server.use(
      http.patch(`${API}/integration-tokens/:pk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El vencimiento supera el máximo.',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.ttl_too_long', max_days: 7 },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const { result } = renderHook(() => useUpdateIntegrationToken(), { wrapper })
    act(() => {
      result.current.mutate({ tokenPk: 12, body: { scopes: ['migrations.rollback'] } })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toApiError(result.current.error).apiTokenContext?.maxDays).toBe(7)
  })

  it('ante un 404 invalida el listado: la fila en pantalla ya no es real', async () => {
    server.use(
      http.patch(`${API}/integration-tokens/:pk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Token no encontrado.',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.not_found' },
            },
          },
          { status: 404 },
        ),
      ),
    )
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateIntegrationToken(), {
      wrapper: wrapperWith(queryClient),
    })
    act(() => {
      result.current.mutate({ tokenPk: 12, body: { name: 'nuevo-nombre' } })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrationTokens.all })
  })
})

describe('useRevokeIntegrationToken', () => {
  it('usa la PK numérica en la URL y devuelve la fila revocada', async () => {
    let calledPath: string | null = null
    server.use(
      http.delete(`${API}/integration-tokens/:pk`, ({ params }) => {
        calledPath = String(params.pk)
        return HttpResponse.json({
          data: { ...tokenFixture, active: false, revoked_at: '2026-10-11T10:00:00Z' },
        })
      }),
    )
    const { result } = renderHook(() => useRevokeIntegrationToken(), { wrapper })
    act(() => {
      result.current.mutate(12)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calledPath).toBe('12')
    expect(result.current.data?.active).toBe(false)
  })

  it('el 409 «ya revocado» falla en la mutación pero invalida el listado', async () => {
    server.use(
      http.delete(`${API}/integration-tokens/:pk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El token ya estaba revocado.',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.already_revoked' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useRevokeIntegrationToken(), {
      wrapper: wrapperWith(queryClient),
    })
    act(() => {
      result.current.mutate(12)
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrationTokens.all })
  })
})
