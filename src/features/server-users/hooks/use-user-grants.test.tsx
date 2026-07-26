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

  it('con requiresDatabase (PostgreSQL) no consulta hasta indicar la base de datos', async () => {
    // Sin handler MSW registrado: si la query se disparara, onUnhandledRequest:'error' fallaría.
    const { result, rerender } = renderHook(
      ({ database }: { database: string | undefined }) => useUserGrants(7, database, true, true),
      { wrapper, initialProps: { database: undefined as string | undefined } },
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isLoading).toBe(false)

    server.use(
      http.get('http://localhost/api/v1/server-users/7/grants', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('database')).toBe('app_prod')
        return HttpResponse.json({
          data: [
            {
              level: 'table',
              object: 'app_prod.users',
              privileges: ['SELECT'],
              with_grant_option: false,
            },
          ],
        })
      }),
    )

    rerender({ database: 'app_prod' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
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
