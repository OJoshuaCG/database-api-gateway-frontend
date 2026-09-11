import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from './use-api-tokens'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const tokenFixture = {
  id: 12,
  token_id: 'k3f9qm2x',
  name: 'ci-tienda-retail',
  scopes: ['blueprints.read'],
  project_id: 4,
  expires_at: '2026-10-09T12:00:00Z',
  last_used_at: null,
  revoked_at: null,
  note: 'Pipeline de nightly',
  active: true,
  created_at: '2026-09-09T12:00:00Z',
}

const pagination = { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false }

describe('useApiTokens', () => {
  it('mapea el listado paginado y distingue id de token_id', async () => {
    server.use(
      http.get('http://localhost/api/v1/api-tokens', () =>
        HttpResponse.json({ data: [tokenFixture], pagination }),
      ),
    )
    const { result } = renderHook(() => useApiTokens({ page: 1, size: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // `id` es la PK que va en el DELETE; `token_id` es la parte pública del bearer que audita.
    // Confundirlos produce un 404 que se lee como «el token no existe».
    expect(result.current.data?.items[0]?.id).toBe(12)
    expect(result.current.data?.items[0]?.token_id).toBe('k3f9qm2x')
  })
})

describe('useCreateApiToken', () => {
  it('devuelve el bearer completo y los scopes EFECTIVOS, no los pedidos', async () => {
    server.use(
      http.post('http://localhost/api/v1/api-tokens', () =>
        HttpResponse.json(
          {
            data: { ...tokenFixture, token: 'dbgw.k3f9qm2x.secreto' },
            message: 'Token emitido.',
          },
          { status: 201 },
        ),
      ),
    )
    const { result } = renderHook(() => useCreateApiToken(), { wrapper })
    act(() => {
      // Se piden DOS scopes...
      result.current.mutate({
        name: 'ci-tienda-retail',
        project_id: 4,
        scopes: ['blueprints.read', 'blueprints.write'],
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.token).toBe('dbgw.k3f9qm2x.secreto')
    // ...y el servidor devuelve UNO: intersectó con el techo de agente. La pantalla tiene que
    // mostrar esto y nunca lo que eligió el operador.
    expect(result.current.data?.scopes).toEqual(['blueprints.read'])
  })
})

describe('useRevokeApiToken', () => {
  it('usa la PK numérica en la URL, no el token_id', async () => {
    let calledPath: string | null = null
    server.use(
      http.delete('http://localhost/api/v1/api-tokens/:pk', ({ params }) => {
        calledPath = String(params.pk)
        return HttpResponse.json({
          data: { ...tokenFixture, active: false, revoked_at: '2026-09-11T10:00:00Z' },
        })
      }),
    )
    const { result } = renderHook(() => useRevokeApiToken(), { wrapper })
    act(() => {
      result.current.mutate(12)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calledPath).toBe('12')
    expect(result.current.data?.active).toBe(false)
  })

  it('trata el 409 «ya revocado» como éxito idempotente', async () => {
    server.use(
      http.delete('http://localhost/api/v1/api-tokens/:pk', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El token ya estaba revocado.',
              type: 'AppHttpException',
              public_context: { code: 'api_token.already_revoked' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { result } = renderHook(() => useRevokeApiToken(), { wrapper })
    act(() => {
      result.current.mutate(12)
    })
    // El acceso ya estaba cortado, que es el estado que se buscaba: la mutación falla pero la UI
    // no lo presenta como un error del operador.
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
