import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { managedDatabaseFixture } from '@/test/fixtures/authz-catalog'
import { useSetAgentAccess } from './use-managed-databases'

const API = 'http://localhost/api/v1'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useSetAgentAccess', () => {
  it('hace PUT con los dos flags y devuelve la base con el estado nuevo', async () => {
    let received: unknown = null
    server.use(
      http.put(`${API}/managed-databases/11/agent-access`, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          data: managedDatabaseFixture({ agent_access_allowed: true }),
        })
      }),
    )
    const { result } = renderHook(() => useSetAgentAccess(11), { wrapper })

    result.current.mutate({ allowed: true, blocked: false })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(received).toEqual({ allowed: true, blocked: false })
    expect(result.current.data?.agent_access_allowed).toBe(true)
  })

  it('un error del backend deja la mutación en error', async () => {
    server.use(
      http.put(`${API}/managed-databases/11/agent-access`, () =>
        HttpResponse.json({ detail: 'sin permiso' }, { status: 500 }),
      ),
    )
    const { result } = renderHook(() => useSetAgentAccess(11), { wrapper })

    result.current.mutate({ allowed: true, blocked: false })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
