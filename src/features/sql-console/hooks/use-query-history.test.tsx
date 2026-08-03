import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { createTestQueryClient } from '@/test/utils'
import { useQueryHistory } from './use-query-history'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SERVER_ID = 7
const HISTORY_URL = `http://localhost/api/v1/servers/${SERVER_ID}/query/history`

const historyFixture = {
  id: 501,
  server_id: SERVER_ID,
  database_name: 'ventas',
  engine: 'mysql',
  admin_username: 'admin',
  connection_mode: 'provided',
  run_as_username: 'app_ro',
  impersonated_role: null,
  sql_text: 'SELECT * FROM clientes',
  danger_level: 'read',
  statement_count: 1,
  status: 'success',
  read_only: true,
  dry_run: false,
  committed: false,
  rows_returned: 12,
  rows_affected: 0,
  duration_ms: 18.4,
  error_code: null,
  error_message: null,
  created_at: '2026-08-01T10:00:00Z',
}

describe('useQueryHistory', () => {
  it('mapea el envelope con la clave `pagination` (el estándar del gateway)', async () => {
    server.use(
      http.get(HISTORY_URL, () =>
        HttpResponse.json({
          data: [historyFixture],
          pagination: { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false },
        }),
      ),
    )

    const { result } = renderHook(() => useQueryHistory(SERVER_ID, { page: 1, size: 20 }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.items[0]?.run_as_username).toBe('app_ro')
    expect(result.current.data?.pagination).toEqual({
      page: 1,
      size: 20,
      total: 1,
      pages: 1,
      has_next: false,
      has_prev: false,
    })
  })

  it('acepta la clave `meta` del contrato v6 §7 y deriva pages/has_next/has_prev', async () => {
    // El contrato del historial nombra `meta` (solo total/page/size) mientras el resto de la
    // API usa `pagination`. Aceptar ambas es lo que evita que la pantalla se caiga entera por
    // una discrepancia de nombre en un módulo todavía sin validar contra motores reales.
    server.use(
      http.get(HISTORY_URL, () =>
        HttpResponse.json({
          data: [historyFixture],
          meta: { total: 45, page: 2, size: 20 },
        }),
      ),
    )

    const { result } = renderHook(() => useQueryHistory(SERVER_ID, { page: 2, size: 20 }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.pagination).toEqual({
      page: 2,
      size: 20,
      total: 45,
      // 45 filas de 20 en 20 son 3 páginas; en la 2 hay anterior y siguiente.
      pages: 3,
      has_next: true,
      has_prev: true,
    })
  })

  it('no dispara la petición cuando `enabled` es false', () => {
    // Sin handler registrado: si la query arrancara, MSW fallaría por petición no manejada.
    const { result } = renderHook(() => useQueryHistory(SERVER_ID, { page: 1, size: 20 }, false), {
      wrapper,
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('no dispara la petición cuando el serverId no es válido', () => {
    for (const serverId of [0, -1, Number.NaN]) {
      const { result } = renderHook(() => useQueryHistory(serverId, { page: 1, size: 20 }), {
        wrapper,
      })
      expect(result.current.fetchStatus).toBe('idle')
      expect(result.current.data).toBeUndefined()
    }
  })
})
