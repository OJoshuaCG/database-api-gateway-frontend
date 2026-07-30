import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useServerDatabases } from './use-server-databases'
import { useDatabaseGrantees } from './use-database-grantees'
import {
  useCreateServerDatabase,
  useDropDatabasePreview,
  useDropServerDatabase,
} from './use-server-database-mutations'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const PHYSICAL_URL = 'http://localhost/api/v1/servers/42/databases'
const INVENTORY_URL = 'http://localhost/api/v1/managed-databases'

function pagination(overrides: Partial<{ total: number; pages: number; has_next: boolean }> = {}) {
  return {
    page: 1,
    size: 50,
    total: 1,
    pages: 1,
    has_next: false,
    has_prev: false,
    ...overrides,
  }
}

function managedRow(name: string, id = 7) {
  return {
    id,
    name,
    server_id: 42,
    owner_id: 5,
    status: 'active',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  }
}

describe('useServerDatabases', () => {
  it('cruza el listado físico del motor con el inventario', async () => {
    server.use(
      http.get(PHYSICAL_URL, () => HttpResponse.json({ data: ['ventas', 'temporal'] })),
      http.get(INVENTORY_URL, () =>
        HttpResponse.json({ data: [managedRow('ventas')], pagination: pagination() }),
      ),
    )

    const { result } = renderHook(() => useServerDatabases(42), { wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    await waitFor(() => expect(result.current.inventory.isSuccess).toBe(true))
    expect(result.current.rows[0]).toMatchObject({ name: 'ventas', isManaged: true })
    expect(result.current.rows[0]?.managed?.id).toBe(7)
    expect(result.current.rows[1]).toMatchObject({ name: 'temporal', isManaged: false })
    expect(result.current.inventoryTruncated).toBe(false)
  })

  it('sigue mostrando las bases físicas aunque el inventario falle (fallo parcial)', async () => {
    server.use(
      http.get(PHYSICAL_URL, () => HttpResponse.json({ data: ['ventas'] })),
      http.get(INVENTORY_URL, () =>
        HttpResponse.json({ detail: { msg: 'Boom', type: 'AppHttpException' } }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useServerDatabases(42), { wrapper })

    await waitFor(() => expect(result.current.inventory.isError).toBe(true))
    expect(result.current.physical.isSuccess).toBe(true)
    expect(result.current.rows).toEqual([{ name: 'ventas', managed: null, isManaged: false }])
  })

  it('señala que el inventario quedó truncado cuando hay más páginas', async () => {
    server.use(
      http.get(PHYSICAL_URL, () => HttpResponse.json({ data: ['ventas'] })),
      http.get(INVENTORY_URL, () =>
        HttpResponse.json({
          data: [managedRow('ventas')],
          pagination: pagination({ total: 300, pages: 6, has_next: true }),
        }),
      ),
    )

    const { result } = renderHook(() => useServerDatabases(42), { wrapper })

    await waitFor(() => expect(result.current.inventoryTruncated).toBe(true))
  })

  it('no consulta nada con un serverId inválido', () => {
    const { result } = renderHook(() => useServerDatabases(0), { wrapper })
    expect(result.current.physical.fetchStatus).toBe('idle')
    expect(result.current.rows).toEqual([])
  })
})

describe('useDatabaseGrantees', () => {
  it('mapea la respuesta de MySQL, con host e is_global', async () => {
    server.use(
      http.get(`${PHYSICAL_URL}/ventas/users`, () =>
        HttpResponse.json({
          data: {
            dialect: 'mysql',
            supports_hosts: true,
            database: 'ventas',
            grantees: [
              {
                username: 'app',
                host: '%',
                is_global: false,
                privileges: ['INSERT', 'SELECT'],
                levels: ['database', 'table'],
                status: 'adopted',
                server_user_id: 12,
              },
              {
                username: 'reportes',
                host: '%',
                is_global: true,
                privileges: ['SELECT'],
                levels: ['global'],
                status: 'unmanaged',
                server_user_id: null,
              },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useDatabaseGrantees(42, 'ventas'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.supports_hosts).toBe(true)
    expect(result.current.data?.grantees[1]?.is_global).toBe(true)
    // `server_user_id` llega como null explícito, no ausente.
    expect(result.current.data?.grantees[1]?.server_user_id).toBeNull()
  })

  it('acepta host null y supports_hosts=false en PostgreSQL', async () => {
    server.use(
      http.get(`${PHYSICAL_URL}/ventas/users`, () =>
        HttpResponse.json({
          data: {
            dialect: 'postgresql',
            supports_hosts: false,
            database: 'ventas',
            grantees: [
              {
                username: 'app_pg',
                host: null,
                is_global: false,
                privileges: ['CONNECT', 'OWNER', 'SELECT'],
                levels: ['database', 'table'],
                status: 'adopted',
                server_user_id: 7,
              },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useDatabaseGrantees(42, 'ventas'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.supports_hosts).toBe(false)
    expect(result.current.data?.grantees[0]?.host).toBeNull()
  })

  it('codifica los nombres legados en el path', async () => {
    server.use(
      http.get(`${PHYSICAL_URL}/ventas.2026/users`, () =>
        HttpResponse.json({
          data: { dialect: 'mysql', supports_hosts: true, database: 'ventas.2026', grantees: [] },
        }),
      ),
    )

    const { result } = renderHook(() => useDatabaseGrantees(42, 'ventas.2026'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.grantees).toEqual([])
  })

  it('no consulta si no hay base de datos seleccionada', () => {
    const { result } = renderHook(() => useDatabaseGrantees(42, null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateServerDatabase', () => {
  it('crea sin registrar y devuelve managed_database_id null', async () => {
    server.use(
      http.post(PHYSICAL_URL, () =>
        HttpResponse.json(
          {
            data: {
              database: 'ventas',
              engine: 'mysql',
              registered: false,
              managed_database_id: null,
            },
            message: 'Base de datos creada.',
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useCreateServerDatabase(42), { wrapper })
    act(() => result.current.mutate({ name: 'ventas', register: false }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.registered).toBe(false)
    expect(result.current.data?.managed_database_id).toBeNull()
  })

  it('propaga el 409 de nombre ya existente sin reintentar', async () => {
    server.use(
      http.post(PHYSICAL_URL, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Ya existe una base de datos con ese nombre en el servidor.',
              type: 'AppHttpException',
            },
          },
          { status: 409 },
        ),
      ),
    )

    const { result } = renderHook(() => useCreateServerDatabase(42), { wrapper })
    act(() => result.current.mutate({ name: 'ventas', register: false }))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 409 })
  })
})

describe('useDropDatabasePreview', () => {
  it('devuelve el token, la caducidad y las advertencias del backend', async () => {
    server.use(
      http.post(`${PHYSICAL_URL}/ventas/drop-preview`, () =>
        HttpResponse.json({
          data: {
            database: 'ventas',
            engine: 'postgresql',
            active_connections: 3,
            is_managed: true,
            managed_database_id: 42,
            confirm_token: '1799999999.a3f9c1',
            expires_at: '2026-07-29T21:32:00Z',
            warnings: ['La base de datos tiene 3 conexión(es) activa(s).'],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useDropDatabasePreview(42), { wrapper })
    act(() => result.current.mutate('ventas'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.confirm_token).toBe('1799999999.a3f9c1')
    expect(result.current.data?.active_connections).toBe(3)
    expect(result.current.data?.warnings).toHaveLength(1)
  })

  it('acepta una respuesta sin advertencias', async () => {
    server.use(
      http.post(`${PHYSICAL_URL}/temporal/drop-preview`, () =>
        HttpResponse.json({
          data: {
            database: 'temporal',
            engine: 'mysql',
            active_connections: 0,
            is_managed: false,
            managed_database_id: null,
            confirm_token: 'token',
            expires_at: '2026-07-29T21:32:00Z',
            warnings: [],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useDropDatabasePreview(42), { wrapper })
    act(() => result.current.mutate('temporal'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.is_managed).toBe(false)
    expect(result.current.data?.managed_database_id).toBeNull()
  })
})

describe('useDropServerDatabase', () => {
  it('envía el nombre y el token, y devuelve el resultado compuesto', async () => {
    let receivedBody: unknown = null
    server.use(
      http.delete(`${PHYSICAL_URL}/ventas`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({
          data: {
            database: 'ventas',
            engine: 'postgresql',
            dropped: true,
            inventory_removed: true,
            terminated_connections: 3,
          },
          message: 'Base de datos eliminada.',
        })
      }),
    )

    const { result } = renderHook(() => useDropServerDatabase(42), { wrapper })
    act(() =>
      result.current.mutate({
        database: 'ventas',
        body: {
          confirm_target_name: 'ventas',
          confirm_token: 'token',
          force_disconnect: true,
        },
      }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedBody).toMatchObject({
      confirm_target_name: 'ventas',
      confirm_token: 'token',
      force_disconnect: true,
    })
    expect(result.current.data?.inventory_removed).toBe(true)
    expect(result.current.data?.terminated_connections).toBe(3)
  })

  it('expone el 410 de token caducado tal cual, sin reintentar', async () => {
    let calls = 0
    server.use(
      http.delete(`${PHYSICAL_URL}/ventas`, () => {
        calls += 1
        return HttpResponse.json(
          {
            detail: {
              msg: 'El token de confirmación expiró; vuelve a solicitar el preview.',
              type: 'AppHttpException',
            },
          },
          { status: 410 },
        )
      }),
    )

    const { result } = renderHook(() => useDropServerDatabase(42), { wrapper })
    act(() =>
      result.current.mutate({
        database: 'ventas',
        body: { confirm_target_name: 'ventas', confirm_token: 'viejo' },
      }),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 410 })
    // Un DELETE irreversible jamás debe reintentarse solo.
    expect(calls).toBe(1)
  })

  it('no reintenta ante un 504, donde el borrado pudo haberse ejecutado', async () => {
    let calls = 0
    server.use(
      http.delete(`${PHYSICAL_URL}/ventas`, () => {
        calls += 1
        return HttpResponse.json(
          { detail: { msg: 'Timeout', type: 'AppHttpException' } },
          { status: 504 },
        )
      }),
    )

    const { result } = renderHook(() => useDropServerDatabase(42), { wrapper })
    act(() =>
      result.current.mutate({
        database: 'ventas',
        body: { confirm_target_name: 'ventas', confirm_token: 'token' },
      }),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })
})
