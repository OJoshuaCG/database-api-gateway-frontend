import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useRotateCrypto } from './use-crypto-rotation'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useRotateCrypto', () => {
  it('rota la clave y expone los contadores de re-cifrado', async () => {
    server.use(
      http.post('http://localhost/api/v1/admin/crypto/rotate', () =>
        HttpResponse.json({
          data: { servers_reencrypted: 12, server_users_reencrypted: 30 },
          message: 'Clave de cifrado rotada.',
        }),
      ),
    )

    const { result } = renderHook(() => useRotateCrypto(), { wrapper })

    act(() => {
      result.current.mutate()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.servers_reencrypted).toBe(12)
    expect(result.current.data?.server_users_reencrypted).toBe(30)
  })
})
