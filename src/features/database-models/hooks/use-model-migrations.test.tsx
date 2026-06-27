import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useCreateModelMigration, useModelMigrations } from './use-model-migrations'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const summaryFixture = {
  id: 1,
  model_id: 3,
  version: '0001',
  name: 'Esquema inicial',
  has_mysql_override: false,
  has_postgresql_override: false,
  has_rollback: false,
  checksum: 'abc123',
  created_at: '2026-06-23T10:00:00Z',
}

const detailFixture = {
  ...summaryFixture,
  up_sql: 'CREATE TABLE orders (id INT PRIMARY KEY)',
  down_sql: null,
  down_sql_suggested: 'DROP TABLE IF EXISTS orders;',
  translated: {
    mysql: 'CREATE TABLE orders (id INT PRIMARY KEY)',
    postgresql: 'CREATE TABLE orders (id INT PRIMARY KEY)',
  },
  updated_at: '2026-06-23T10:00:00Z',
}

describe('useModelMigrations', () => {
  it('mapea el listado paginado de resúmenes', async () => {
    server.use(
      http.get('http://localhost/api/v1/database-models/3/migrations', () =>
        HttpResponse.json({
          data: [summaryFixture],
          pagination: { page: 1, size: 10, total: 1, pages: 1, has_next: false, has_prev: false },
        }),
      ),
    )

    const { result } = renderHook(() => useModelMigrations(3, { page: 1, size: 10 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.version).toBe('0001')
  })
})

describe('useCreateModelMigration', () => {
  it('crea una migración y devuelve translated + down_sql_suggested', async () => {
    server.use(
      http.post('http://localhost/api/v1/database-models/3/migrations', () =>
        HttpResponse.json({ data: detailFixture, message: 'Migración creada.' }),
      ),
    )

    const { result } = renderHook(() => useCreateModelMigration(3), { wrapper })

    act(() => {
      result.current.mutate({
        version: '0001',
        name: 'Esquema inicial',
        up_sql: 'CREATE TABLE orders (id INT PRIMARY KEY)',
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.down_sql_suggested).toBe('DROP TABLE IF EXISTS orders;')
    expect(result.current.data?.translated.postgresql).toContain('orders')
  })
})
