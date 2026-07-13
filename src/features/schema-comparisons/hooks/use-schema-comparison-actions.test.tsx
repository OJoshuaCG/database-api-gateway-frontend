import { describe, expect, it } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useAdoptComparison, useCreateSchemaComparison } from './use-schema-comparison-actions'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useCreateSchemaComparison', () => {
  it('no dispara ningún toast cuando la creación falla (el asistente maneja el error inline)', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Motores incompatibles: no se puede comparar postgresql con mysql.',
              type: 'AppHttpException',
            },
          },
          { status: 422 },
        ),
      ),
    )

    const { result } = renderHook(() => useCreateSchemaComparison(), { wrapper })

    act(() => {
      result.current.mutate({ source_database_id: 7, target_database_id: 12 })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('emite un toast de éxito al crear la comparación', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons', () =>
        HttpResponse.json({
          data: {
            id: 42,
            source_database_id: 7,
            target_database_id: 12,
            source_engine: 'mysql',
            target_engine: 'mysql',
            cross_flavor_warning: false,
            scope_note: null,
            item_count: 18,
            counts: {},
            has_destructive: false,
            expired: false,
            created_at: '2026-07-13T10:00:00',
            expires_at: '2026-07-14T10:00:00',
          },
        }),
      ),
    )

    const { result } = renderHook(() => useCreateSchemaComparison(), { wrapper })

    act(() => {
      result.current.mutate({ source_database_id: 7, target_database_id: 12 })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(screen.queryByRole('status')).not.toBeNull()
  })
})

describe('useAdoptComparison', () => {
  it('no dispara ningún toast cuando el anti-TOCTOU rechaza el adopt (409)', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons/42/adopt', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El esquema del target cambió desde que se calculó la comparación; recalcúlala.',
              type: 'AppHttpException',
            },
          },
          { status: 409 },
        ),
      ),
    )

    const { result } = renderHook(() => useAdoptComparison(42), { wrapper })

    act(() => {
      result.current.mutate({ selected_item_ids: [1, 2], name: 'v1', execute_immediately: false })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
