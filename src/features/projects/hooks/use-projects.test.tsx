import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders } from '@/test/utils'
import { toApiError } from '@/lib/api/errors'
import {
  useDeleteProject,
  useLinkProjectBlueprints,
  useProjectBlueprints,
  useProjects,
} from './use-projects'

// `AllProviders` y no solo `QueryClientProvider`: estos hooks emiten toasts en `onSuccess`, así
// que sin `ToastProvider` reventarían por el contexto ausente y no por lo que se quiere probar.
function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders>{children}</AllProviders>
}

const projectFixture = {
  id: 1,
  name: 'Clientes Retail',
  description: 'Blueprints de las tiendas.',
  blueprint_count: 3,
  created_at: '2026-08-22T10:00:00Z',
  updated_at: '2026-08-22T10:00:00Z',
}

describe('useProjects', () => {
  it('mapea el envelope paginado a { items, pagination }', async () => {
    server.use(
      http.get('http://localhost/api/v1/projects', () =>
        HttpResponse.json({
          data: [projectFixture],
          pagination: { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false },
        }),
      ),
    )

    const { result } = renderHook(() => useProjects({ page: 1, size: 20 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.items[0]?.blueprint_count).toBe(3)
  })

  it('acepta `description: null`, que es como viaja una descripción vacía dentro de `data`', async () => {
    server.use(
      http.get('http://localhost/api/v1/projects', () =>
        HttpResponse.json({
          data: [{ ...projectFixture, description: null }],
          pagination: { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false },
        }),
      ),
    )

    const { result } = renderHook(() => useProjects({ page: 1, size: 20 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.description).toBeNull()
  })
})

describe('useProjectBlueprints', () => {
  it('lee una lista NO paginada (sin bloque `pagination`)', async () => {
    server.use(
      http.get('http://localhost/api/v1/projects/1/blueprints', () =>
        HttpResponse.json({
          data: [
            {
              id: 4,
              name: 'Whatsapp',
              slug: 'whatsapp',
              description: null,
              current_version: '0007',
              is_active: true,
              charset: 'utf8mb4',
              collation: 'utf8mb4_unicode_ci',
              created_at: '2026-08-22T10:00:00Z',
              updated_at: '2026-08-22T10:00:00Z',
            },
          ],
        }),
      ),
    )

    const { result } = renderHook(() => useProjectBlueprints(1), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    // `current_version` es un STRING: parsearlo a número perdería los ceros a la izquierda.
    expect(result.current.data?.[0]?.current_version).toBe('0007')
  })
})

describe('useLinkProjectBlueprints', () => {
  it('trata `already_linked` como éxito, no como fallo', async () => {
    server.use(
      http.post('http://localhost/api/v1/projects/1/blueprints', () =>
        HttpResponse.json({
          data: { project_id: 1, linked: [], already_linked: [4], blueprint_count: 1 },
          message: 'Blueprints vinculados al proyecto.',
        }),
      ),
    )

    const { result } = renderHook(() => useLinkProjectBlueprints(1), { wrapper })
    result.current.mutate([4])

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.already_linked).toEqual([4])
    expect(result.current.data?.linked).toEqual([])
  })

  it('expone `missing_model_ids` del 422 para poder señalar las filas concretas', async () => {
    server.use(
      http.post('http://localhost/api/v1/projects/1/blueprints', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Hay blueprints inexistentes en la selección; no se vinculó ninguno: 99, 120',
              type: 'AppHttpException',
              public_context: {
                code: 'project.blueprints_not_found',
                missing_model_ids: [99, 120],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )

    const { result } = renderHook(() => useLinkProjectBlueprints(1), { wrapper })
    result.current.mutate([4, 99, 120])

    await waitFor(() => expect(result.current.isError).toBe(true))
    const apiError = toApiError(result.current.error)
    expect(apiError.code).toBe('project.blueprints_not_found')
    expect(apiError.missingModelIds).toEqual([99, 120])
  })
})

describe('useDeleteProject', () => {
  it('un 404 se resuelve como éxito idempotente: el proyecto ya no está, que es lo que se pedía', async () => {
    server.use(
      http.delete('http://localhost/api/v1/projects/1', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El proyecto no existe.',
              type: 'AppHttpException',
              public_context: { code: 'project.not_found' },
            },
          },
          { status: 404 },
        ),
      ),
    )

    const { result } = renderHook(() => useDeleteProject(), { wrapper })
    result.current.mutate(1)

    // La mutación sí falla —el 404 es un 404—, pero el hook no lo trata como un fracaso de cara
    // al usuario: no emite toast de error. Lo que se verifica aquí es que el error llega
    // clasificado por código, que es lo que permite esa decisión.
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toApiError(result.current.error).code).toBe('project.not_found')
  })
})
