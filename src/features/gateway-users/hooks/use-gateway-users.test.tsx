import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useAcceptGatewayUserInvite,
  useCreateGatewayUser,
  useGatewayUsers,
  useReplaceGatewayUserAccess,
} from './use-gateway-users'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const userFixture = {
  id: 7,
  username: 'mlopez',
  email: 'mlopez@empresa.com',
  full_name: 'Marina López',
  gateway_role: 'operator',
  is_active: true,
  credential_set: false,
  global_capabilities: ['access_admin'],
  scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
  last_login_at: '2026-09-01T14:02:11Z',
  previous_login_at: '2026-08-28T09:41:03Z',
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

const pagination = { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false }

describe('useGatewayUsers', () => {
  it('mapea el listado PAGINADO y conserva credential_set', () => {
    server.use(
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({ data: [userFixture], pagination }),
      ),
    )
    const { result } = renderHook(() => useGatewayUsers({ page: 1, size: 20 }), { wrapper })
    return waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
      // `credential_set: false` es un estado propio: la cuenta existe, está activa y NO puede
      // entrar. Si el contrato lo perdiera, la pantalla mostraría acceso donde no lo hay.
      expect(result.current.data?.items[0]?.credential_set).toBe(false)
      expect(result.current.data?.items[0]?.is_active).toBe(true)
    })
  })

  it('tolera un rol desconocido sin descartar el listado entero', async () => {
    // El vocabulario lo decide el backend y puede crecer sin desplegar la SPA. Un `z.enum` duro
    // haría desaparecer TODAS las filas, no solo la rara.
    server.use(
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({
          data: [{ ...userFixture, gateway_role: 'auditor_nuevo' }],
          pagination,
        }),
      ),
    )
    const { result } = renderHook(() => useGatewayUsers({ page: 1, size: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.gateway_role).toBe('auditor_nuevo')
  })
})

describe('useCreateGatewayUser', () => {
  it('devuelve el token de invitación, que viaja una sola vez', async () => {
    server.use(
      http.post('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json(
          {
            data: {
              ...userFixture,
              invite_token: '1757462400.9f2c1a',
              invite_expires_at: '2026-09-11T18:00:00Z',
            },
            message: 'Usuario creado.',
          },
          { status: 201 },
        ),
      ),
    )
    const { result } = renderHook(() => useCreateGatewayUser(), { wrapper })
    act(() => {
      result.current.mutate({ username: 'mlopez' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.invite_token).toBe('1757462400.9f2c1a')
    expect(result.current.data?.invite_expires_at).toBe('2026-09-11T18:00:00Z')
  })
})

describe('useReplaceGatewayUserAccess', () => {
  it('manda SIEMPRE los dos campos, porque omitir uno revoca', async () => {
    let received: unknown = null
    server.use(
      http.put('http://localhost/api/v1/gateway-users/7/access', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ data: userFixture })
      }),
    )
    const { result } = renderHook(() => useReplaceGatewayUserAccess(7), { wrapper })
    act(() => {
      result.current.mutate({ global_capabilities: ['access_admin'], scope_grants: [] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // `scope_grants: []` viaja EXPLÍCITO. El contrato obliga a mandarlo justamente para que un
    // formulario no pueda enviar un delta y borrar la otra mitad sin enterarse.
    expect(received).toEqual({ global_capabilities: ['access_admin'], scope_grants: [] })
  })
})

describe('useAcceptGatewayUserInvite', () => {
  it('devuelve el username y NO abre sesión', async () => {
    server.use(
      http.post('http://localhost/api/v1/gateway-users/invite/accept', () =>
        HttpResponse.json({ data: { username: 'mlopez' }, message: 'Contraseña establecida.' }),
      ),
    )
    const { result } = renderHook(() => useAcceptGatewayUserInvite(), { wrapper })
    act(() => {
      result.current.mutate({ token: '1757462400.9f2c1a', password: 'una-contraseña-larga' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ username: 'mlopez' })
  })
})
