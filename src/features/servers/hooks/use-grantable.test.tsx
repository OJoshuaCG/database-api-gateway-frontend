import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useCheckGrantable } from './use-grantable'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useCheckGrantable', () => {
  it('valida la respuesta GrantableResult del pre-chequeo', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/42/grantable', () =>
        HttpResponse.json({
          data: { can_grant: true, level: 'database', privileges: ['SELECT', 'INSERT'] },
        }),
      ),
    )

    const { result } = renderHook(() => useCheckGrantable(42), { wrapper })

    act(() => {
      result.current.mutate({
        level: 'database',
        object_ref: { database: 'app_prod' },
        privileges: ['SELECT', 'INSERT'],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.can_grant).toBe(true)
    expect(result.current.data?.privileges).toEqual(['SELECT', 'INSERT'])
  })
})
