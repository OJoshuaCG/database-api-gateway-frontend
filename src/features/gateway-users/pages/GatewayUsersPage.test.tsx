import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
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
  it('deshabilita «Accesos» en la fila propia, con el motivo a la vista, y no en las demás', async () => {
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

    const buttons = screen.getAllByRole('button', { name: 'Accesos' })
    const disabled = buttons.filter((button) => button.hasAttribute('disabled'))
    const enabled = buttons.filter((button) => !button.hasAttribute('disabled'))
    // Mitad y mitad: la fila propia deshabilitada, la de la otra persona habilitada, en cada vista.
    expect(disabled).toHaveLength(buttons.length / 2)
    expect(enabled).toHaveLength(buttons.length / 2)
    expect(notes).toHaveLength(disabled.length)
  })
})
