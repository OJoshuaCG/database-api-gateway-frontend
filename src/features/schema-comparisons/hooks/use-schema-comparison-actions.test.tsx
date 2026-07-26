import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useAdoptComparison,
  useCreateSchemaComparison,
  useExportSchemaComparisonSql,
} from './use-schema-comparison-actions'

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
            source_server_id: 3,
            source_database_name: 'productos_ref',
            target_server_id: 5,
            target_database_name: 'productos_db',
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

describe('useExportSchemaComparisonSql', () => {
  // jsdom no implementa la API de descarga de blobs; se simula para no romper `downloadBlob`.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()

  it('descarga el .sql y emite un toast de éxito con el filename del header', async () => {
    server.use(
      http.get('http://localhost/api/v1/schema-comparisons/42/export', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.getAll('item_ids')).toEqual(['1', '2'])
        expect(url.searchParams.get('include_rollback')).toBe('true')
        return HttpResponse.text('-- DDL de ejemplo\nCREATE TABLE clientes (id INT);', {
          headers: {
            'Content-Type': 'application/sql',
            'Content-Disposition': 'attachment; filename="schema-diff-42-ventas_prod.sql"',
          },
        })
      }),
    )

    const { result } = renderHook(() => useExportSchemaComparisonSql(42), { wrapper })

    act(() => {
      result.current.mutate({ itemIds: [1, 2], includeRollback: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent('schema-diff-42-ventas_prod.sql')
  })

  it('reenvía los filtros object_type/change_type activos (§10.6) junto con include_rollback', async () => {
    server.use(
      http.get('http://localhost/api/v1/schema-comparisons/42/export', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('object_type')).toBe('view')
        expect(url.searchParams.get('change_type')).toBe('modified')
        expect(url.searchParams.getAll('item_ids')).toEqual([])
        expect(url.searchParams.get('include_rollback')).toBe('true')
        return HttpResponse.text('-- DDL filtrado', {
          headers: {
            'Content-Type': 'application/sql',
            'Content-Disposition': 'attachment; filename="schema-diff-42-filtrado.sql"',
          },
        })
      }),
    )

    const { result } = renderHook(() => useExportSchemaComparisonSql(42), { wrapper })

    act(() => {
      result.current.mutate({ objectType: 'view', changeType: 'modified', includeRollback: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('emite un toast de error (no descarga) cuando la selección no matchea ningún ítem (422)', async () => {
    server.use(
      http.get('http://localhost/api/v1/schema-comparisons/42/export', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No hay sentencias para exportar con la selección/filtros indicados.',
              type: 'AppHttpException',
            },
          },
          { status: 422 },
        ),
      ),
    )

    const { result } = renderHook(() => useExportSchemaComparisonSql(42), { wrapper })

    act(() => {
      result.current.mutate({})
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No hay sentencias para exportar con la selección/filtros indicados.',
    )
  })
})
