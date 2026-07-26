import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useAllSchemaComparisonItems,
  useExecutePreview,
  useResolveComparisonSelection,
  useSchemaComparison,
} from './use-schema-comparisons'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

function item(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    comparison_id: 1,
    seq: id,
    object_type: 'column',
    object_name: `t.col${id}`,
    change_type: 'new',
    phase: 1,
    sql: `ALTER TABLE t ADD COLUMN col${id} INT`,
    risk_flags: {
      destructive: false,
      lock_heavy: false,
      data_conversion: false,
      needs_review: false,
      requires_individual_review: false,
      cross_flavor_warning: false,
      possible_rename_of: null,
    },
    op_group: null,
    depends_on: [],
    down_sql: null,
    down_confirmed: false,
    execution_status: null,
    execution_error: null,
    executed_at: null,
    ...overrides,
  }
}

describe('useSchemaComparison', () => {
  it('expone el resumen de una comparación', async () => {
    server.use(
      http.get('http://localhost/api/v1/schema-comparisons/42', () =>
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
            counts: { table: { new: 1 } },
            has_destructive: true,
            expired: false,
            created_at: '2026-07-13T10:00:00',
            expires_at: '2026-07-14T10:00:00',
          },
        }),
      ),
    )

    const { result } = renderHook(() => useSchemaComparison(42, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.has_destructive).toBe(true)
  })
})

describe('useAllSchemaComparisonItems', () => {
  it('pagina hasta agotar has_next y concatena todos los ítems', async () => {
    server.use(
      http.get('http://localhost/api/v1/schema-comparisons/42/items', ({ request }) => {
        const url = new URL(request.url)
        const page = Number(url.searchParams.get('page'))
        if (page === 1) {
          return HttpResponse.json({
            data: [item(1), item(2)],
            pagination: { page: 1, size: 2, total: 3, pages: 2, has_next: true, has_prev: false },
          })
        }
        return HttpResponse.json({
          data: [item(3)],
          pagination: { page: 2, size: 2, total: 3, pages: 2, has_next: false, has_prev: true },
        })
      }),
    )

    const { result } = renderHook(() => useAllSchemaComparisonItems(42, {}, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items.map((i) => i.id)).toEqual([1, 2, 3])
    expect(result.current.data?.truncated).toBe(false)
  })
})

describe('useExecutePreview', () => {
  it('no dispara la llamada en modo custom sin selección', () => {
    const { result } = renderHook(() => useExecutePreview(42, 'custom', [], true), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('obtiene el confirm_token para el modo resuelto', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons/42/execute-preview', () =>
        HttpResponse.json({
          data: {
            comparison_id: 42,
            target_database_id: 12,
            mode: 'all_except_destructive',
            statements: [],
            plan_warnings: [],
            excluded_by_dependency: [],
            confirm_token: 'abc123',
          },
        }),
      ),
    )

    const { result } = renderHook(
      () => useExecutePreview(42, 'all_except_destructive', [], true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.confirm_token).toBe('abc123')
  })

  it('acepta target_database_id null (target crudo sin adoptar)', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons/42/execute-preview', () =>
        HttpResponse.json({
          data: {
            comparison_id: 42,
            target_database_id: null,
            mode: 'all_except_destructive',
            statements: [],
            plan_warnings: [],
            excluded_by_dependency: [],
            confirm_token: 'abc123',
          },
        }),
      ),
    )

    const { result } = renderHook(
      () => useExecutePreview(42, 'all_except_destructive', [], true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.target_database_id).toBeNull()
  })

  it('expone plan_warnings y excluded_by_dependency (§10.6) del preview', async () => {
    server.use(
      http.post('http://localhost/api/v1/schema-comparisons/42/execute-preview', () =>
        HttpResponse.json({
          data: {
            comparison_id: 42,
            target_database_id: 12,
            mode: 'all_except_destructive',
            statements: [],
            plan_warnings: [
              {
                code: 'create_and_drop_same_object',
                message: 'Se crea y elimina el mismo objeto; probablemente sea un rename.',
                op_group: 'view:v_ventas',
              },
            ],
            excluded_by_dependency: ['fk:ventas'],
            confirm_token: 'abc123',
          },
        }),
      ),
    )

    const { result } = renderHook(
      () => useExecutePreview(42, 'all_except_destructive', [], true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.plan_warnings[0]?.code).toBe('create_and_drop_same_object')
    expect(result.current.data?.excluded_by_dependency).toEqual(['fk:ventas'])
  })
})

describe('useResolveComparisonSelection', () => {
  it('no dispara la llamada sin selección', () => {
    const { result } = renderHook(() => useResolveComparisonSelection(42, [], true), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('resuelve el cierre: ids ordenados en el body y resolved_item_ids en orden de ejecución', async () => {
    let requestedBody: unknown = null
    server.use(
      http.post(
        'http://localhost/api/v1/schema-comparisons/42/resolve-selection',
        async ({ request }) => {
          requestedBody = await request.json()
          return HttpResponse.json({
            data: {
              comparison_id: 42,
              requested_item_ids: [3, 7],
              resolved_item_ids: [1, 3, 7],
              added_item_ids: [1],
              added_reasons: { 'table:clientes': ['fk:ventas'] },
              added: [
                {
                  item_id: 1,
                  object_type: 'table',
                  object_name: 'clientes',
                  change_type: 'new',
                  sql: 'CREATE TABLE clientes (id INT)',
                },
              ],
              total: 3,
            },
          })
        },
      ),
    )

    const { result } = renderHook(() => useResolveComparisonSelection(42, [7, 3], true), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // El conjunto viaja ordenado (la query key no depende del orden de marcado).
    expect(requestedBody).toEqual({ selected_item_ids: [3, 7] })
    expect(result.current.data?.resolved_item_ids).toEqual([1, 3, 7])
    expect(result.current.data?.added_item_ids).toEqual([1])
    expect(result.current.isStale).toBe(false)
  })
})
