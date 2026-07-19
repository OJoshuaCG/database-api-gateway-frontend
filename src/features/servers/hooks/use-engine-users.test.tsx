import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useCreateEngineUser,
  useDeleteEngineUser,
  useGroupedEngineUsers,
  useRevealEngineUserPassword,
} from './use-engine-users'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useGroupedEngineUsers', () => {
  it('mapea la vista agrupada por username con supports_hosts', async () => {
    server.use(
      http.get('http://localhost/api/v1/servers/42/users/grouped', () =>
        HttpResponse.json({
          data: {
            dialect: 'mysql',
            supports_hosts: true,
            users: [
              {
                username: 'alice',
                identity_count: 2,
                identities: [
                  {
                    host: 'localhost',
                    status: 'adopted',
                    server_user_id: 12,
                    has_password: true,
                    is_active: true,
                  },
                  { host: '%', status: 'unmanaged', has_password: false },
                ],
              },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useGroupedEngineUsers(42), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.supports_hosts).toBe(true)
    expect(result.current.data?.users[0]?.identities).toHaveLength(2)
  })
})

describe('useCreateEngineUser', () => {
  it('crea el usuario en el motor y expone si quedó adoptado', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/42/users', () =>
        HttpResponse.json({
          data: { username: 'bob', host: '%', adopted: true, server_user_id: 9 },
          message: "Usuario 'bob' creado.",
        }),
      ),
    )

    const { result } = renderHook(() => useCreateEngineUser(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'bob', password: 's3cr3t', adopt: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.adopted).toBe(true)
    expect(result.current.data?.server_user_id).toBe(9)
  })

  it('propaga el 409 del guard anti auto-lockout (credencial pseudo-root)', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/42/users', () =>
        HttpResponse.json(
          { detail: 'No se puede operar sobre la credencial pseudo-root del gateway.' },
          { status: 409 },
        ),
      ),
    )

    const { result } = renderHook(() => useCreateEngineUser(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'gateway_root', password: 'x' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 409 })
  })
})

describe('useDeleteEngineUser', () => {
  it('envía confirm_username en query y resuelve en éxito', async () => {
    let receivedUrl: URL | undefined
    server.use(
      http.delete('http://localhost/api/v1/servers/42/users', ({ request }) => {
        receivedUrl = new URL(request.url)
        return HttpResponse.json({ message: 'Usuario eliminado' })
      }),
    )

    const { result } = renderHook(() => useDeleteEngineUser(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', host: 'localhost', confirmUsername: 'alice' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedUrl?.searchParams.get('confirm_username')).toBe('alice')
    expect(receivedUrl?.searchParams.get('host')).toBe('localhost')
  })
})

describe('useRevealEngineUserPassword', () => {
  it('propaga un 409 cuando el gateway nunca fijó la contraseña', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/42/users/reveal-password', () =>
        HttpResponse.json(
          { detail: 'Solo se puede rotar la contraseña, no revelarla.' },
          { status: 409 },
        ),
      ),
    )

    const { result } = renderHook(() => useRevealEngineUserPassword(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', host: '%' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 409 })
    // El secreto nunca llega a existir en este camino: no hay `.data` que limpiar.
    expect(result.current.data).toBeUndefined()
  })

  it('expone la contraseña en claro solo en el resultado de la mutación (no en caché)', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/42/users/reveal-password', () =>
        HttpResponse.json({ data: { username: 'alice', host: '%', password: 's3cr3t' } }),
      ),
    )

    const { result } = renderHook(() => useRevealEngineUserPassword(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', host: '%' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.password).toBe('s3cr3t')
  })
})
