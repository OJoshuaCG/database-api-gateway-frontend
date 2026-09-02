import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useApplyProfileToDatabases,
  useGrantPrivilegesToDatabases,
  useUserGrants,
} from './use-user-grants'

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

describe('useGrantPrivilegesToDatabases', () => {
  it('otorga base por base y un fallo no aborta las demás', async () => {
    // El contrato no tiene bulk para privilegios sueltos (v21 §12): son N llamadas, y lo que
    // importa probar es justo que la segunda no se pierde porque la primera devolvió 403.
    const seen: string[] = []
    server.use(
      http.post('http://localhost/api/v1/server-users/7/grants', async ({ request }) => {
        const body = (await request.json()) as { object_ref: { database?: string } }
        const database = body.object_ref.database ?? ''
        seen.push(database)
        if (database === 'shop_b') {
          return HttpResponse.json(
            {
              detail: { msg: 'El gateway no puede delegar SELECT aquí.', type: 'AppHttpException' },
            },
            { status: 403 },
          )
        }
        return HttpResponse.json({
          data: {
            granted: true,
            level: 'database',
            privileges: ['SELECT'],
            with_grant_option: false,
          },
        })
      }),
    )

    const { result } = renderHook(() => useGrantPrivilegesToDatabases(7, 3), { wrapper })

    act(() => {
      result.current.mutate(
        ['shop_a', 'shop_b', 'shop_c'].map((database) => ({
          label: database,
          body: {
            level: 'database' as const,
            object_ref: { database },
            privileges: ['SELECT'],
            with_grant_option: false,
          },
        })),
      )
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toEqual(['shop_a', 'shop_b', 'shop_c'])
    expect(result.current.data?.map((outcome) => outcome.ok)).toEqual([true, false, true])
    expect(result.current.data?.[1]?.error).toContain('delegar')
  })
})

describe('useApplyProfileToDatabases', () => {
  it('parte la selección en tandas de 20 y concatena los resultados en orden', async () => {
    const batches: string[][] = []
    server.use(
      http.post(
        'http://localhost/api/v1/server-users/7/apply-profile/3/bulk',
        async ({ request }) => {
          const body = (await request.json()) as { databases: string[] }
          batches.push(body.databases)
          return HttpResponse.json({
            data: {
              profile_id: 3,
              profile_name: 'solo-lectura',
              engine: 'mysql',
              total_databases: body.databases.length,
              results: body.databases.map((database) => ({
                database,
                grants_applied: 2,
                skipped_levels: [],
                errors: [],
                ok: true,
              })),
            },
          })
        },
      ),
    )

    const databases = Array.from({ length: 25 }, (_, index) => `shop_${index}`)
    const { result } = renderHook(() => useApplyProfileToDatabases(7, 3), { wrapper })

    act(() => {
      result.current.mutate({
        profileId: 3,
        databases,
        objectMappings: [{ level: 'database', object_ref: {} }],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(batches.map((batch) => batch.length)).toEqual([20, 5])
    expect(result.current.data?.results.map((item) => item.database)).toEqual(databases)
    expect(result.current.data?.grantsApplied).toBe(50)
  })

  it('un lote entero fallido llega con 200: el éxito se lee de results[].ok', async () => {
    server.use(
      http.post('http://localhost/api/v1/server-users/7/apply-profile/3/bulk', () =>
        HttpResponse.json({
          data: {
            profile_id: 3,
            profile_name: 'solo-lectura',
            engine: 'mysql',
            total_databases: 2,
            results: [
              {
                database: 'shop_a',
                grants_applied: 0,
                skipped_levels: [],
                errors: ['table: no existe «orders»'],
                ok: false,
              },
              {
                database: 'shop_b',
                grants_applied: 0,
                skipped_levels: ['column'],
                errors: ['table: no existe «orders»'],
                ok: false,
              },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useApplyProfileToDatabases(7, 3), { wrapper })

    act(() => {
      result.current.mutate({
        profileId: 3,
        databases: ['shop_a', 'shop_b'],
        objectMappings: [{ level: 'table', object_ref: { table: 'orders' } }],
      })
    })

    // La mutación NO falla —el status fue 200— y por eso la pantalla no puede decidir el éxito
    // mirando `isError`: tiene que leer cada `results[].ok`.
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.results.every((item) => item.ok)).toBe(false)
    expect(result.current.data?.grantsApplied).toBe(0)
  })
})
