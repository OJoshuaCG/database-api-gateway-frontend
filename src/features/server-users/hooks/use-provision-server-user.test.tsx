import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useProvisionServerUser } from './use-provision-server-user'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const userFixture = {
  id: 7,
  server_id: 42,
  username: 'app_user',
  host: '%',
  is_active: true,
  notes: null,
  has_password: true,
  created_at: '2026-06-23T10:00:00Z',
  updated_at: '2026-06-23T10:00:00Z',
}

describe('useProvisionServerUser', () => {
  it('crea + aprovisiona y expone el ServerUserFullOut', async () => {
    server.use(
      http.post('http://localhost/api/v1/server-users/provision', () =>
        HttpResponse.json({
          data: {
            user: userFixture,
            grants_applied: 1,
            grant_results: [
              {
                level: 'database',
                object: 'app_prod',
                privileges: ['SELECT'],
                success: true,
                error: null,
              },
            ],
          },
          message: "Usuario 'app_user' aprovisionado.",
        }),
      ),
    )

    const { result } = renderHook(() => useProvisionServerUser(), { wrapper })

    act(() => {
      result.current.mutate({
        server_id: 42,
        username: 'app_user',
        host: '%',
        password: 'p@ss',
        initial_grants: [
          { level: 'database', object_ref: { database: 'app_prod' }, privileges: ['SELECT'] },
        ],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.grants_applied).toBe(1)
    expect(result.current.data?.user.username).toBe('app_user')
  })
})
