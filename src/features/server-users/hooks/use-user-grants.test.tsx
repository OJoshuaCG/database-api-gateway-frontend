import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useGrantPrivileges, useUserGrants } from './use-user-grants'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useUserGrants', () => {
  it('mapea la lista de GrantInfo efectivos', async () => {
    server.use(
      http.get('http://localhost/api/v1/server-users/7/grants', () =>
        HttpResponse.json({
          data: [
            {
              level: 'database',
              object: 'app_prod',
              privileges: ['SELECT', 'INSERT'],
              with_grant_option: false,
            },
          ],
        }),
      ),
    )

    const { result } = renderHook(() => useUserGrants(7, undefined, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]?.object).toBe('app_prod')
  })
})

describe('useGrantPrivileges', () => {
  it('otorga privilegios y expone el GrantResult', async () => {
    server.use(
      http.post('http://localhost/api/v1/server-users/7/grants', () =>
        HttpResponse.json({
          data: {
            granted: true,
            level: 'database',
            privileges: ['SELECT'],
            with_grant_option: false,
          },
          message: 'Privilegio(s) otorgado(s).',
        }),
      ),
    )

    const { result } = renderHook(() => useGrantPrivileges(7), { wrapper })

    act(() => {
      result.current.mutate({
        level: 'database',
        object_ref: { database: 'app_prod' },
        privileges: ['SELECT'],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.granted).toBe(true)
  })
})
