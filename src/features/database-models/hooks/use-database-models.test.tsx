import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { server } from '@/test/server'
import { queryKeys } from '@/lib/api/query-keys'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useUpdateDatabaseModel } from './use-database-models'

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AllProviders queryClient={client}>{children}</AllProviders>
  }
}

const PATCH_URL = 'http://localhost/api/v1/database-models/3'
const LIST_PARAMS = { page: 1, size: 20 }

const modelFixture = {
  id: 3,
  name: 'Whatsapp Business',
  slug: 'whatsapp',
  description: null,
  current_version: '1.2.0',
  is_active: true,
  charset: null,
  collation: null,
  created_at: '2026-06-23T10:00:00Z',
  updated_at: '2026-09-07T12:00:00Z',
}

describe('useUpdateDatabaseModel', () => {
  it('renombra el blueprint y devuelve el modelo actualizado', async () => {
    server.use(http.patch(PATCH_URL, () => HttpResponse.json({ data: modelFixture })))

    const { result } = renderHook(() => useUpdateDatabaseModel(3), {
      wrapper: wrapperWith(createTestQueryClient()),
    })

    act(() => result.current.mutate({ name: 'Whatsapp Business' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.name).toBe('Whatsapp Business')
  })

  /**
   * La regresión que motiva el test: renombrar desde `ProjectDetailPage` dejaba el nombre viejo
   * en la tabla del proyecto. Esa lista cuelga de `['projects', id, 'blueprints']`, que no
   * comparte prefijo con `['database-models']`, y el QueryClient de la app no la refresca por su
   * cuenta (`staleTime: 30_000`, `refetchOnWindowFocus: false`).
   */
  it('invalida el inventario de blueprints Y las listas de blueprints por proyecto', async () => {
    server.use(http.patch(PATCH_URL, () => HttpResponse.json({ data: modelFixture })))

    const client = createTestQueryClient()
    client.setQueryData(queryKeys.databaseModels.list(LIST_PARAMS), null)
    client.setQueryData(queryKeys.projects.blueprints(7), null)

    const { result } = renderHook(() => useUpdateDatabaseModel(3), {
      wrapper: wrapperWith(client),
    })

    act(() => result.current.mutate({ name: 'Whatsapp Business' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await waitFor(() => {
      expect(client.getQueryState(queryKeys.databaseModels.list(LIST_PARAMS))?.isInvalidated).toBe(
        true,
      )
      expect(client.getQueryState(queryKeys.projects.blueprints(7))?.isInvalidated).toBe(true)
    })
  })

  /**
   * El predicado apunta a `[2] === 'blueprints'` justamente para NO barrer la vista inversa
   * `['projects', 'of-blueprint', modelId]`, que lista los PROYECTOS de un blueprint: ahí el
   * nombre del blueprint no se pinta, así que invalidarla sería una recarga sin motivo.
   */
  it('no toca la vista inversa `projects.ofBlueprint`', async () => {
    server.use(http.patch(PATCH_URL, () => HttpResponse.json({ data: modelFixture })))

    const client = createTestQueryClient()
    client.setQueryData(queryKeys.projects.ofBlueprint(3), null)

    const { result } = renderHook(() => useUpdateDatabaseModel(3), {
      wrapper: wrapperWith(client),
    })

    act(() => result.current.mutate({ name: 'Whatsapp Business' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(client.getQueryState(queryKeys.projects.ofBlueprint(3))?.isInvalidated).toBe(false)
  })
})
