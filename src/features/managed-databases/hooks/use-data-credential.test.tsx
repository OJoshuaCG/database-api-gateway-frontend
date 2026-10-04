import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useApproveDataAccess,
  useClearDataCredential,
  useDataCredential,
  useProvisionDataCredential,
  useRequestDataAccess,
  useRevokeDataAccess,
  useVerifyDataCredential,
} from './use-managed-databases'

const API = 'http://localhost/api/v1'
const BASE = `${API}/managed-databases/11`

function status(overrides: Record<string, unknown> = {}) {
  return {
    managed_database_id: 11,
    has_data_credential: true,
    verified_at: null,
    probed_at: null,
    probe_violations: [],
    probe_warnings: [],
    data_access_allowed: false,
    data_access_state: 'closed',
    data_access_second_approver_required: true,
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useDataCredential', () => {
  it('no consulta mientras está apagado', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/data-credential`, () => {
        calls += 1
        return HttpResponse.json({ data: status() })
      }),
    )
    const { result } = renderHook(() => useDataCredential(11, false), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(0)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('valida la respuesta con Zod y aplica los defaults cerrados', async () => {
    server.use(
      http.get(`${BASE}/data-credential`, () =>
        HttpResponse.json({ data: { managed_database_id: 11, has_data_credential: false } }),
      ),
    )
    const { result } = renderHook(() => useDataCredential(11, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data_access_state).toBe('closed')
    expect(result.current.data?.data_access_second_approver_required).toBe(true)
  })
})

describe('mutaciones de la credencial y del opt-in de datos', () => {
  it.each([
    ['provision', 'POST', `${BASE}/data-credential/provision`, useProvisionDataCredential],
    ['verify', 'POST', `${BASE}/data-credential/verify`, useVerifyDataCredential],
    ['clear', 'DELETE', `${BASE}/data-credential`, useClearDataCredential],
    ['request', 'POST', `${BASE}/data-access/request`, useRequestDataAccess],
    ['approve', 'POST', `${BASE}/data-access/approve`, useApproveDataAccess],
    ['revoke', 'DELETE', `${BASE}/data-access`, useRevokeDataAccess],
  ] as const)(
    '%s llama %s %s y devuelve el estado nuevo, sin cuerpo',
    async (_n, method, url, hook) => {
      let body: string | null = null
      const handler = async ({ request }: { request: Request }) => {
        body = await request.text()
        return HttpResponse.json({ data: status({ data_access_state: 'pending' }) })
      }
      server.use(method === 'POST' ? http.post(url, handler) : http.delete(url, handler))
      const { result } = renderHook(() => hook(11), { wrapper })

      result.current.mutate()

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toBe('')
      expect(result.current.data?.data_access_state).toBe('pending')
    },
  )

  it('un 403 de auto-aprobación deja la mutación en error con su código', async () => {
    server.use(
      http.post(`${BASE}/data-access/approve`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No podés aprobar tu propio pedido.',
              type: 'AppHttpException',
              public_context: { code: 'data_access.self_approval_forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    const { result } = renderHook(() => useApproveDataAccess(11), { wrapper })

    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('no reintenta una escritura sobre el motor aunque falle', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/data-credential/provision`, () => {
        calls += 1
        return HttpResponse.json({ detail: { msg: 'motor caído' } }, { status: 502 })
      }),
    )
    const { result } = renderHook(() => useProvisionDataCredential(11), { wrapper })

    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })
})
