import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { SELF_ACCESS_NOTE } from '../self-access'
import { GatewayUsersPage } from './GatewayUsersPage'

function gatewayUser(id: number, username: string) {
  return {
    id,
    username,
    email: `${username}@empresa.com`,
    full_name: null,
    gateway_role: 'owner',
    is_active: true,
    credential_set: true,
    global_capabilities: ['access_admin'],
    scope_grants: [],
    last_login_at: null,
    previous_login_at: null,
    last_failed_at: null,
    created_at: '2026-08-20T11:00:00Z',
  }
}

const pagination = { page: 1, size: 20, total: 2, pages: 1, has_next: false, has_prev: false }

describe('GatewayUsersPage — la fila de la propia cuenta', () => {
  it('deshabilita «Accesos» en la fila propia, con el motivo a la vista, y enlaza en las demás', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { id: 1, username: 'admin', role: 'owner', base_role: 'owner' },
        }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({
          data: [gatewayUser(1, 'admin'), gatewayUser(7, 'mlopez')],
          pagination,
        }),
      ),
    )
    renderWithProviders(<GatewayUsersPage />)

    // El aviso aparece cuando llegaron la sesión y el listado. `DataTable` pinta la tabla y las
    // tarjetas de móvil a la vez (una la esconde el CSS), así que cada fila existe dos veces.
    const notes = await screen.findAllByText(SELF_ACCESS_NOTE)
    expect(notes.length).toBeGreaterThan(0)

    // La fila propia lleva un botón deshabilitado; la de la otra persona, un enlace a su página
    // de accesos. Una de cada por vista (tabla y tarjetas).
    const disabled = screen.getAllByRole('button', { name: 'Accesos' })
    expect(disabled.every((button) => button.hasAttribute('disabled'))).toBe(true)
    const links = screen.getAllByRole('link', { name: 'Accesos' })
    expect(links).toHaveLength(disabled.length)
    for (const link of links) expect(link).toHaveAttribute('href', '/gateway-users/7/accesos')
    expect(notes).toHaveLength(disabled.length)
  })
})

describe('GatewayUsersPage — sin acceso', () => {
  it('un 403 muestra el estado de acceso compartido, sin «Reintentar» y con «Ver mi acceso»', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({ data: { id: 3, username: 'lector', role: 'viewer' } }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No tienes permiso para esta operación.',
              type: 'AppHttpException',
              public_context: { code: 'access.forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    renderWithProviders(<GatewayUsersPage />)
    // El título nombra la pantalla; es contenido de página (`status`), no una alerta.
    const title = await screen.findByText('No tenés acceso a Usuarios del gateway')
    expect(title.closest('[role="status"]')).not.toBeNull()
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Secciones de usuarios del gateway')
    expect(screen.getByRole('link', { name: 'Ver mi acceso' })).toHaveAttribute(
      'href',
      '/mi-cuenta',
    )
    // El mismo pedido con el mismo acceso da el mismo 403: no hay nada que reintentar.
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument()
  })

  it('sin `access.admin` entra a «Roles y capacidades» y no ofrece el alta', async () => {
    let listRequests = 0
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { ...meFixture({ role: 'owner' }), id: 3, username: 'duena' },
        }),
      ),
      http.get('http://localhost/api/v1/authz/catalog', () =>
        HttpResponse.json({ data: CATALOG_FIXTURE }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () => {
        listRequests += 1
        return HttpResponse.json({ data: [], pagination })
      }),
    )
    renderWithProviders(<GatewayUsersPage />)
    // Sin `?tab`, el listado sería un 403 seguro: la pestaña por defecto es la que le sirve.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Roles y capacidades' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(await screen.findByText('Otorga 12 de 35')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument()
    // Ni se ofrece la pestaña (como «Cifrado» en Administración) ni se pide el listado.
    expect(screen.queryByRole('tab', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(listRequests).toBe(0)
  })

  it('sin `access.admin`, pedir el listado a mano muestra el estado de acceso', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { ...meFixture({ role: 'owner' }), id: 3, username: 'duena' },
        }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({ data: [], pagination }),
      ),
    )
    renderWithProviders(<GatewayUsersPage />, { route: '/gateway-users?tab=users' })
    expect(await screen.findByText('No tenés acceso a Usuarios del gateway')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument()
  })
})

describe('GatewayUsersPage — estados de la cuenta', () => {
  it('«Invitación pendiente» se explica en una leyenda visible, no en un `title`', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { id: 1, username: 'admin', role: 'owner', base_role: 'owner' },
        }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({
          data: [{ ...gatewayUser(7, 'mlopez'), credential_set: false }],
          pagination: { ...pagination, total: 1 },
        }),
      ),
    )
    renderWithProviders(<GatewayUsersPage />)
    const legend = await screen.findByRole('region', { name: 'Qué significa cada estado' })
    expect(legend).toHaveTextContent('todavía no puede iniciar sesión')
    for (const badge of screen.getAllByText('Invitación pendiente')) {
      expect(badge).not.toHaveAttribute('title')
    }
  })
})

describe('GatewayUsersPage — bandeja de solicitudes pendientes', () => {
  const pendingRow = {
    id: 12,
    user_id: 7,
    username: 'mlopez',
    capability: 'databases.drop',
    scope_type: 'server',
    scope_id: 9,
    scope_name: 'db-prod-01',
    status: 'pending',
    sensitive: true,
    requested_by: { id: 2, username: 'otra-admin' },
    requested_at: '2026-10-01T18:00:00Z',
    expires_at: '2026-10-08T18:00:00Z',
    implies: [],
    can_decide: true,
    blocked_reason: null,
  }

  const accessRow = {
    id: 21,
    target: { id: 8, username: 'jperez' },
    requested_by: { id: 2, username: 'otra-admin' },
    status: 'pending',
    origin: 'update',
    desired: { gateway_role: 'owner', global_capabilities: [], scope_grants: [] },
    elevations: [{ kind: 'base_role', role: 'owner' }],
    sod_override: null,
    created_at: '2026-10-01T18:00:00Z',
    expires_at: '2026-10-08T18:00:00Z',
    can_decide: true,
    blocked_reason: null,
  }

  function mockAs(
    globals: string[],
    pending: unknown[] = [pendingRow],
    elevations: unknown[] = [accessRow],
  ) {
    let pendingRequests = 0
    server.use(
      http.get('http://localhost/api/v1/access-requests/pending', () => {
        pendingRequests += 1
        return HttpResponse.json({ data: elevations })
      }),
      http.get('http://localhost/api/v1/access-requests/21', () =>
        HttpResponse.json({
          data: { ...accessRow, status: 'applied', decided_by: { id: 4, username: 'aa2' } },
        }),
      ),
      http.get('http://localhost/api/v1/gateway-users/8', () =>
        HttpResponse.json({
          data: { ...gatewayUser(8, 'jperez'), gateway_role: 'operator', global_capabilities: [] },
        }),
      ),
      http.get('http://localhost/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.get('http://localhost/api/v1/servers', () =>
        HttpResponse.json({ data: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { ...meFixture({ role: 'owner', global_capabilities: globals }), id: 1 },
        }),
      ),
      http.get('http://localhost/api/v1/authz/catalog', () =>
        HttpResponse.json({ data: CATALOG_FIXTURE }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({ data: [], pagination }),
      ),
      http.get('http://localhost/api/v1/capability-grants/pending', () => {
        pendingRequests += 1
        return HttpResponse.json({ data: pending })
      }),
    )
    return () => pendingRequests
  }

  it('access_admin ve la pestaña con el recuento de las DOS bandejas y las abre juntas', async () => {
    mockAs(['access_admin'])
    renderWithProviders(<GatewayUsersPage />)

    const tab = await screen.findByRole('tab', { name: /Solicitudes pendientes/ })
    // Una capacidad puntual + una elevación de acceso.
    await waitFor(() => expect(tab).toHaveTextContent('Solicitudes pendientes2'))
    await userEvent.click(tab)
    expect(screen.getByRole('heading', { name: 'Elevaciones de acceso' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Capacidades puntuales' })).toBeInTheDocument()
    // Cada una con su fila: la elevación (jperez → owner) y la puntual (mlopez).
    expect(await screen.findAllByText('jperez')).not.toHaveLength(0)
    expect(await screen.findAllByText('operator → owner')).not.toHaveLength(0)
    expect(await screen.findAllByText('mlopez')).not.toHaveLength(0)
  })

  it('al llegar desde el aviso de un 202 destaca la solicitud con su estado actual', async () => {
    mockAs(['access_admin'], [], [])
    renderWithProviders(<GatewayUsersPage />, {
      route: '/gateway-users?tab=pending&solicitud=21',
    })
    // Otra persona ya la aprobó entre el aviso y el clic: no está en la bandeja, pero se dice.
    expect(
      await screen.findByText('La solicitud de jperez ya no está pendiente'),
    ).toBeInTheDocument()
    expect(screen.getByText(/se aprobó y ya rige \(aa2\)/)).toBeInTheDocument()
  })

  it('security_officer no tiene `access.admin`: ni listado ni bandeja, y entra a «Roles y capacidades»', async () => {
    const requests = mockAs(['security_officer'])
    renderWithProviders(<GatewayUsersPage />)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Roles y capacidades' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByRole('tab', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Solicitudes pendientes/ })).not.toBeInTheDocument()
    expect(requests()).toBe(0)
  })

  it('sin access_admin, `?tab=pending` muestra el estado de acceso', async () => {
    mockAs([])
    renderWithProviders(<GatewayUsersPage />, { route: '/gateway-users?tab=pending' })
    expect(
      await screen.findByText('No tenés acceso a las solicitudes pendientes'),
    ).toBeInTheDocument()
  })
})

describe('GatewayUsersPage — alta con elevación pendiente (202)', () => {
  it('entrega la invitación igual y dice, fijo, que el rol pedido espera a otra persona', async () => {
    let createBody: unknown = null
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({
          data: { ...meFixture({ role: 'viewer', global_capabilities: ['access_admin'] }), id: 1 },
        }),
      ),
      http.get('http://localhost/api/v1/authz/catalog', () =>
        HttpResponse.json({ data: CATALOG_FIXTURE }),
      ),
      http.get('http://localhost/api/v1/gateway-users', () =>
        HttpResponse.json({ data: [], pagination }),
      ),
      http.get('http://localhost/api/v1/capability-grants/pending', () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get('http://localhost/api/v1/access-requests/pending', () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post('http://localhost/api/v1/gateway-users', async ({ request }) => {
        createBody = await request.json()
        return HttpResponse.json(
          {
            data: {
              ...gatewayUser(9, 'ana'),
              gateway_role: 'viewer',
              global_capabilities: [],
              credential_set: false,
              invite_token: '1757462400.9f2c1a',
              invite_expires_at: '2026-10-09T10:00:00Z',
              code: 'access.elevation_pending',
              pending_request: {
                id: 12,
                status: 'pending',
                origin: 'create',
                target: { id: 9, username: 'ana' },
                requested_by: { id: 1, username: 'admin' },
                desired: { gateway_role: 'owner', global_capabilities: [], scope_grants: [] },
                elevations: [{ kind: 'base_role', role: 'owner' }],
                created_at: '2026-10-02T10:00:00Z',
                expires_at: '2026-10-09T10:00:00Z',
              },
            },
          },
          { status: 202 },
        )
      }),
    )
    renderWithProviders(<GatewayUsersPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo usuario' }))
    await userEvent.type(screen.getByLabelText(/Nombre de usuario/), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(
      screen.getByRole('option', { name: /^owner\s*Requiere segundo aprobador$/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Crear y generar invitación' }))

    expect(await screen.findByText('Usuario ana creado')).toBeInTheDocument()
    expect(createBody).toMatchObject({ username: 'ana', gateway_role: 'owner' })
    expect(screen.getByText('El acceso pedido todavía no rige')).toBeInTheDocument()
    expect(screen.getByText(/La cuenta se creó como/)).toHaveTextContent('viewer')
    // El enlace fijo del diálogo y el del toast llevan a la misma solicitud.
    const links = screen.getAllByRole('link', { name: 'Ver la solicitud' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/gateway-users?tab=pending&solicitud=12')
    }
  })
})
