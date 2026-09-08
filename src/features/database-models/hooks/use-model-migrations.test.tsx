import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { server } from '@/test/server'
import { queryKeys } from '@/lib/api/query-keys'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { FETCH_ALL_MIGRATIONS_MAX_PAGES } from '../api/model-migrations.api'
import {
  useAllModelMigrations,
  useCreateModelMigration,
  useDeleteModelMigration,
  useModelMigration,
  useModelMigrationDeletePlan,
  useModelMigrations,
} from './use-model-migrations'

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

  it('propaga el `order` al backend', async () => {
    // El navegador de versiones pide `desc` para que la punta venga en la primera página
    // (api-reference-v22 §2); si el parámetro no viajara, volvería a abrir en las más antiguas.
    const seen: string[] = []
    server.use(
      http.get('http://localhost/api/v1/database-models/3/migrations', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('order') ?? '')
        return HttpResponse.json({
          data: [summaryFixture],
          pagination: { page: 1, size: 50, total: 1, pages: 1, has_next: false, has_prev: false },
        })
      }),
    )

    const { result } = renderHook(
      () => useModelMigrations(3, { page: 1, size: 50, order: 'desc' }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toEqual(['desc'])
  })
})

describe('useAllModelMigrations', () => {
  /** Devuelve una página con `has_next` mientras queden, para simular un catálogo largo. */
  function pagedHandler(pages: number) {
    return http.get('http://localhost/api/v1/database-models/3/migrations', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
      return HttpResponse.json({
        data: [{ ...summaryFixture, id: page, version: String(page).padStart(4, '0') }],
        pagination: {
          page,
          size: 50,
          total: pages,
          pages,
          has_next: page < pages,
          has_prev: page > 1,
        },
      })
    })
  }

  it('recorre TODAS las páginas y las concatena', async () => {
    // Es el punto del hook: quedarse con la primera página producía cálculos incompletos sin
    // ninguna señal de que lo eran (qué versiones captura un apply, qué versión se puede stampear).
    server.use(pagedHandler(3))

    const { result } = renderHook(() => useAllModelMigrations(3), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items.map((m) => m.version)).toEqual(['0001', '0002', '0003'])
    expect(result.current.data?.truncated).toBe(false)
  })

  it('con una sola página no pide una segunda', async () => {
    let calls = 0
    server.use(
      http.get('http://localhost/api/v1/database-models/3/migrations', () => {
        calls += 1
        return HttpResponse.json({
          data: [summaryFixture],
          pagination: { page: 1, size: 50, total: 1, pages: 1, has_next: false, has_prev: false },
        })
      }),
    )

    const { result } = renderHook(() => useAllModelMigrations(3), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toBe(1)
  })

  it('avisa con `truncated` al llegar al tope de páginas, en vez de callar la lista corta', async () => {
    server.use(pagedHandler(FETCH_ALL_MIGRATIONS_MAX_PAGES + 5))

    const { result } = renderHook(() => useAllModelMigrations(3), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(FETCH_ALL_MIGRATIONS_MAX_PAGES)
    expect(result.current.data?.truncated).toBe(true)
  })

  it('cuelga del prefijo de invalidación de migraciones', () => {
    // Las mutaciones invalidan por `migrations(modelId)`. Si esta key quedara fuera del prefijo,
    // el catálogo completo se serviría rancio tras crear o borrar una versión.
    expect(queryKeys.databaseModels.migrationsAll(3).slice(0, 3)).toEqual(
      queryKeys.databaseModels.migrations(3),
    )
  })
})

describe('useModelMigration', () => {
  it('acepta un baseline de snapshot cuyo `translated` no trae la traducción a un motor', async () => {
    server.use(
      http.get('http://localhost/api/v1/database-models/1/migrations/0001', () =>
        HttpResponse.json({
          data: {
            ...detailFixture,
            up_sql_postgresql: null,
            down_sql: null,
            down_sql_suggested: null,
            kind: 'schema',
            source_engine: 'mariadb',
            is_baseline: true,
            // sqlglot no logró traducir: la clave `postgresql` está ausente, no `null`.
            translated: { mysql: detailFixture.up_sql },
          },
        }),
      ),
    )

    const { result } = renderHook(() => useModelMigration(1, '0001', true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.translated.mysql).toBe(detailFixture.up_sql)
    expect(result.current.data?.translated.postgresql).toBeUndefined()
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

const DELETE_URL = 'http://localhost/api/v1/database-models/3/migrations/0007'

/** Wrapper atado a UN cliente concreto, para poder espiar sus invalidaciones. */
function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AllProviders queryClient={client}>{children}</AllProviders>
  }
}

describe('useDeleteModelMigration', () => {
  it('manda el `confirm_token` como query param solo cuando hay uno', async () => {
    const urls: string[] = []
    server.use(
      http.delete(DELETE_URL, ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json({
          data: { model_id: 3, version: '0007', renumbered: [], stamped: [] },
        })
      }),
    )

    const { result } = renderHook(() => useDeleteModelMigration(3), {
      wrapper: wrapperWith(createTestQueryClient()),
    })

    act(() => result.current.mutate({ version: '0007', confirmToken: 'tok-123' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(new URL(urls[0]!).searchParams.get('confirm_token')).toBe('tok-123')

    act(() => result.current.mutate({ version: '0007', confirmToken: null }))
    await waitFor(() => expect(urls).toHaveLength(2))
    // Sin token la clave NO viaja: `buildUrl` descarta el `undefined`, así que tampoco llega como
    // la cadena "undefined", que el backend leería como un token inválido.
    expect(new URL(urls[1]!).searchParams.has('confirm_token')).toBe(false)

    act(() => result.current.mutate({ version: '0007' }))
    await waitFor(() => expect(urls).toHaveLength(3))
    expect(new URL(urls[2]!).searchParams.has('confirm_token')).toBe(false)
  })

  it('un gateway pre-v18 responde el envelope SIN la clave `data` y resuelve a `null`', async () => {
    // `ApiResponse._exclude_none` omite las claves nulas de primer nivel: el `data: null` del
    // borrado de la punta llega directamente como clave AUSENTE. Con un schema estricto, un
    // borrado que el backend YA ejecutó se le reportaría al operador como error.
    server.use(
      http.delete(DELETE_URL, () => HttpResponse.json({ message: 'Migración eliminada.' })),
    )

    const { result } = renderHook(() => useDeleteModelMigration(3), {
      wrapper: wrapperWith(createTestQueryClient()),
    })

    act(() => result.current.mutate({ version: '0007' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('invalida la lista de migraciones Y el detalle del blueprint', async () => {
    server.use(
      http.delete(DELETE_URL, () =>
        HttpResponse.json({
          data: { model_id: 3, version: '0007', renumbered: [], stamped: [] },
        }),
      ),
    )

    const client = createTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteModelMigration(3), {
      wrapper: wrapperWith(client),
    })

    act(() => result.current.mutate({ version: '0007' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toContainEqual(queryKeys.databaseModels.migrations(3))
    // El detalle es el que evita que la ficha siga anunciando un `current_version` que, tras el
    // renumerado, ya se llama de otra forma.
    expect(keys).toContainEqual(queryKeys.databaseModels.detail(3))
  })
})

describe('useModelMigrationDeletePlan', () => {
  it('pide el `delete-plan` y devuelve el plan parseado, con `confirm_token: null` si no hace falta', async () => {
    server.use(
      http.get(`${DELETE_URL}/delete-plan`, () =>
        HttpResponse.json({
          data: {
            model_id: 3,
            version: '0007',
            deletable: true,
            renumber: [{ from_version: '0008', to_version: '0007' }],
            stamp_plan: [],
            blockers: [],
            unstampable: [],
            partial_applications: [],
            requires_confirmation: false,
            confirm_token: null,
            expires_at: null,
            warnings: ['Las bases conservan físicamente sus objetos.'],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useModelMigrationDeletePlan(3), {
      wrapper: wrapperWith(createTestQueryClient()),
    })

    act(() => result.current.mutate('0007'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.deletable).toBe(true)
    expect(result.current.data?.renumber).toHaveLength(1)
    // `null` explícito y no ausente: dentro de `data` un nulo viaja como `null`, y es lo que la UI
    // manda tal cual al DELETE para no entrenarse a mandar siempre un token.
    expect(result.current.data?.confirm_token).toBeNull()
    expect(result.current.data?.warnings).toHaveLength(1)
  })
})
