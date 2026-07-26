import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useAdoptAllHosts,
  useChangeEngineUserPasswordAllHosts,
  useCreateEngineUser,
  useDefineKnownPassword,
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

describe('useAdoptAllHosts', () => {
  it('adopta todas las identidades y trata already_adopted como éxito (no error)', async () => {
    let body: unknown
    server.use(
      http.post('http://localhost/api/v1/servers/42/users/adopt-all-hosts', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            data: {
              username: 'alice',
              dialect: 'mysql',
              total_hosts: 3,
              adopted: 2,
              results: [
                { host: 'localhost', status: 'adopted', server_user_id: 41 },
                { host: '%', status: 'already_adopted', server_user_id: 12 },
                { host: '10.0.0.5', status: 'adopted', server_user_id: 42 },
              ],
            },
          },
          { status: 201 },
        )
      }),
    )

    const { result } = renderHook(() => useAdoptAllHosts(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', known_password: 's3cr3t', notes: null })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toMatchObject({ username: 'alice', known_password: 's3cr3t' })
    expect(result.current.data?.adopted).toBe(2)
    expect(result.current.data?.results).toHaveLength(3)
    expect(result.current.data?.results[1]?.status).toBe('already_adopted')
  })

  it('acepta results con host null (PostgreSQL)', async () => {
    server.use(
      http.post('http://localhost/api/v1/servers/7/users/adopt-all-hosts', () =>
        HttpResponse.json(
          {
            data: {
              username: 'pg_role',
              dialect: 'postgresql',
              total_hosts: 1,
              adopted: 1,
              results: [{ host: null, status: 'adopted', server_user_id: 90 }],
            },
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useAdoptAllHosts(7), { wrapper })

    act(() => {
      result.current.mutate({ username: 'pg_role' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.results[0]?.host).toBeNull()
  })
})

describe('useDefineKnownPassword', () => {
  it('resuelve 200 con conflict_needs_overwrite en results (no es error)', async () => {
    let body: unknown
    server.use(
      http.post('http://localhost/api/v1/servers/42/users/define-password', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          data: {
            username: 'alice',
            scope: 'all_hosts',
            total_hosts: 2,
            updated: 1,
            results: [
              { host: '%', status: 'updated', server_user_id: 12 },
              { host: 'localhost', status: 'conflict_needs_overwrite', server_user_id: 41 },
            ],
          },
        })
      }),
    )

    const { result } = renderHook(() => useDefineKnownPassword(42), { wrapper })

    act(() => {
      result.current.mutate({
        username: 'alice',
        scope: 'all_hosts',
        known_password: 'conocida',
        adopt_if_missing: false,
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toMatchObject({ username: 'alice', scope: 'all_hosts' })
    expect(result.current.data?.results[1]?.status).toBe('conflict_needs_overwrite')
  })

  it('reenvía con overwrite=true para sobrescribir contraseñas ya guardadas', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('http://localhost/api/v1/servers/42/users/define-password', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json({
          data: {
            username: 'alice',
            scope: 'host',
            total_hosts: 1,
            updated: body.overwrite ? 1 : 0,
            results: [
              {
                host: '%',
                status: body.overwrite ? 'updated' : 'conflict_needs_overwrite',
                server_user_id: 12,
              },
            ],
          },
        })
      }),
    )

    const { result } = renderHook(() => useDefineKnownPassword(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', scope: 'host', host: '%', known_password: 'x' })
    })
    await waitFor(() =>
      expect(result.current.data?.results[0]?.status).toBe('conflict_needs_overwrite'),
    )

    act(() => {
      result.current.mutate({ ...result.current.variables!, overwrite: true })
    })
    await waitFor(() => expect(result.current.data?.results[0]?.status).toBe('updated'))
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toMatchObject({ overwrite: true, host: '%' })
  })
})

describe('useChangeEngineUserPasswordAllHosts', () => {
  it('expone el detalle por host cuando la rotación es parcial (status error)', async () => {
    let body: unknown
    server.use(
      http.patch(
        'http://localhost/api/v1/servers/42/users/password-all-hosts',
        async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({
            data: {
              username: 'alice',
              total_hosts: 2,
              updated: 1,
              results: [
                { host: '%', status: 'rotated', server_user_id: 12, adopted: false, error: null },
                {
                  host: 'localhost',
                  status: 'error',
                  server_user_id: null,
                  adopted: false,
                  error: 'motor caído',
                },
              ],
            },
          })
        },
      ),
    )

    const { result } = renderHook(() => useChangeEngineUserPasswordAllHosts(42), { wrapper })

    act(() => {
      result.current.mutate({
        username: 'alice',
        new_password: 'nueva',
        confirm_username: 'alice',
        adopt_if_missing: true,
      })
    })

    // Fail-tolerant: HTTP 200 aunque un host falle — el desenlace vive en results[].
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toMatchObject({ confirm_username: 'alice', adopt_if_missing: true })
    expect(result.current.data?.results[1]?.status).toBe('error')
    expect(result.current.data?.results[1]?.error).toBe('motor caído')
  })

  it('propaga el 422 cuando confirm_username no coincide', async () => {
    server.use(
      http.patch('http://localhost/api/v1/servers/42/users/password-all-hosts', () =>
        HttpResponse.json({ detail: 'confirm_username no coincide.' }, { status: 422 }),
      ),
    )

    const { result } = renderHook(() => useChangeEngineUserPasswordAllHosts(42), { wrapper })

    act(() => {
      result.current.mutate({ username: 'alice', new_password: 'x', confirm_username: 'alicia' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 422 })
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
