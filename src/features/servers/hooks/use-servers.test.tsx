import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { createTestQueryClient } from '@/test/utils'
import { useServers } from './use-servers'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const serverFixture = {
  id: 42,
  name: 'mysql-prod',
  host: 'db.example.com',
  port: 3306,
  engine: 'mysql',
  root_username: 'gateway_root',
  ssl_mode: 'require',
  status: 'active',
  is_active: true,
  notes: null,
  has_root_password: true,
  created_at: '2026-06-23T10:00:00Z',
  updated_at: '2026-06-23T10:00:00Z',
}

describe('useServers', () => {
  it('mapea el envelope paginado a { items, pagination }', async () => {
    server.use(
      http.get('http://localhost/api/v1/servers', () =>
        HttpResponse.json({
          data: [serverFixture],
          pagination: { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false },
        }),
      ),
    )

    const { result } = renderHook(() => useServers({ page: 1, size: 20 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.items[0]?.name).toBe('mysql-prod')
    expect(result.current.data?.pagination.total).toBe(1)
  })

  it('propaga un ApiError normalizado en fallo del servidor', async () => {
    server.use(
      http.get('http://localhost/api/v1/servers', () =>
        HttpResponse.json({ detail: 'Boom' }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useServers({ page: 1, size: 20 }), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 500, message: 'Boom' })
  })
})
