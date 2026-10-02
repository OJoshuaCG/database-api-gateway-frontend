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

  it('sin `gateway.admin` entra a «Roles y capacidades» y no ofrece el alta', async () => {
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
    expect(await screen.findByText('Otorga 12 de 31')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument()
    // Ni se ofrece la pestaña (como «Cifrado» en Administración) ni se pide el listado.
    expect(screen.queryByRole('tab', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(listRequests).toBe(0)
  })

  it('sin `gateway.admin`, pedir el listado a mano muestra el estado de acceso', async () => {
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

  function mockAs(globals: string[], pending: unknown[] = [pendingRow]) {
    let pendingRequests = 0
    server.use(
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

  it('access_admin ve la pestaña con el recuento y abre la bandeja', async () => {
    mockAs(['access_admin'])
    renderWithProviders(<GatewayUsersPage />)

    const tab = await screen.findByRole('tab', { name: /Solicitudes pendientes/ })
    await waitFor(() => expect(tab).toHaveTextContent('Solicitudes pendientes1'))
    await userEvent.click(tab)
    expect(await screen.findAllByText('mlopez')).not.toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Solicitudes pendientes' })).toBeInTheDocument()
  })

  it('sin access_admin no hay pestaña ni se pide la bandeja', async () => {
    const requests = mockAs(['security_officer'])
    renderWithProviders(<GatewayUsersPage />)

    await screen.findByRole('tab', { name: 'Usuarios' })
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
