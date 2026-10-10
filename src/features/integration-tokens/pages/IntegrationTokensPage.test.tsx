import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { IntegrationTokensPage } from './IntegrationTokensPage'

const API = 'http://localhost/api/v1'

// El catálogo de fixtures es anterior a `integration_tokens.own`, así que la capacidad se pasa
// por `capabilities` en vez de esperar que `meFixture` la derive del rol.
const OWN_INTEGRATION_TOKENS = ['self.read', 'integration_tokens.own']

const CEILING = {
  enabled: true,
  scopes: [
    { scope: 'servers.list', label: 'Listar servidores permitidos', mutates: false, tier: 'read' },
  ],
  max_ttl_days: 90,
  max_write_ttl_days: 30,
  max_destructive_ttl_days: 7,
  allow_non_expiring: true,
}

function tokenRow(id: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    token_id: `tok${id}`,
    name,
    scopes: ['servers.list'],
    suspended_scopes: [],
    server_ids: [1],
    blueprint_ids: [],
    created_by_admin_id: 1,
    expires_at: '2099-01-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    note: null,
    active: true,
    created_at: '2026-10-10T12:00:00Z',
    ...overrides,
  }
}

const pagination = { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false }

function mockBackend(
  me: Record<string, unknown>,
  rows: Record<string, unknown>[] = [tokenRow(1, 'web-tienda')],
  ceiling: Record<string, unknown> = CEILING,
) {
  const listRequests: URL[] = []
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/integration-tokens/ceiling`, () => HttpResponse.json({ data: ceiling })),
    http.get(`${API}/integration-tokens`, ({ request }) => {
      listRequests.push(new URL(request.url))
      return HttpResponse.json({ data: rows, pagination })
    }),
  )
  return listRequests
}

describe('IntegrationTokensPage', () => {
  it('con integration_tokens.own lista los tokens y deja emitir', async () => {
    const listRequests = mockBackend(
      meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS }),
    )
    renderWithProviders(<IntegrationTokensPage />)

    expect(await screen.findAllByText('web-tienda')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeInTheDocument()
    expect(listRequests).toHaveLength(1)
  })

  it('marca con «Destructivo» solo las filas con un scope destructivo', async () => {
    mockBackend(meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS }), [
      tokenRow(1, 'solo-lectura'),
      tokenRow(2, 'con-rollback', { scopes: ['migrations.rollback'], blueprint_ids: [5] }),
    ])
    renderWithProviders(<IntegrationTokensPage />)

    // La tabla se pinta dos veces (tabla y tarjetas por fila): se compara contra las apariciones
    // de la fila destructiva, no contra un número fijo.
    const destructiveRowCopies = await screen.findAllByText('con-rollback')
    expect(screen.getAllByText('Destructivo')).toHaveLength(destructiveRowCopies.length)
  })

  it('muestra los scopes suspendidos de un token como «suspendido»', async () => {
    mockBackend(meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS }), [
      tokenRow(1, 'web-tienda', { suspended_scopes: ['databases.drop'] }),
    ])
    renderWithProviders(<IntegrationTokensPage />)

    await screen.findAllByText('web-tienda')
    expect(screen.getAllByText('suspendido').length).toBeGreaterThan(0)
  })

  it('con la API apagada avisa, sigue listando y no deja emitir', async () => {
    mockBackend(
      meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS }),
      [tokenRow(1, 'web-tienda')],
      { ...CEILING, enabled: false },
    )
    renderWithProviders(<IntegrationTokensPage />)

    expect(await screen.findAllByText('web-tienda')).not.toHaveLength(0)
    expect(await screen.findByText(/La API de integración está apagada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
  })

  it('solo ofrece editar los tokens activos del propio usuario', async () => {
    const me = meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS })
    const ownAdminId = (me as { id: number }).id
    mockBackend(me, [
      tokenRow(1, 'propio', { created_by_admin_id: ownAdminId }),
      tokenRow(2, 'ajeno', { created_by_admin_id: ownAdminId + 100 }),
    ])
    renderWithProviders(<IntegrationTokensPage />)

    await screen.findAllByText('ajeno')
    expect(screen.getAllByRole('button', { name: 'Editar propio' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Editar ajeno' })).not.toBeInTheDocument()
  })

  it('revocar pide re-tipear el nombre y llama al DELETE del token', async () => {
    const me = meFixture({ role: 'viewer', capabilities: OWN_INTEGRATION_TOKENS })
    const revoked: string[] = []
    mockBackend(me)
    server.use(
      http.delete(`${API}/integration-tokens/1`, ({ request }) => {
        revoked.push(new URL(request.url).pathname)
        return HttpResponse.json({ data: tokenRow(1, 'web-tienda', { active: false }) })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<IntegrationTokensPage />)

    const [revokeButton] = await screen.findAllByRole('button', { name: 'Revocar' })
    await user.click(revokeButton as HTMLElement)
    await user.type(await screen.findByRole('textbox'), 'web-tienda')
    const confirmButtons = screen.getAllByRole('button', { name: 'Revocar' })
    await user.click(confirmButtons[confirmButtons.length - 1] as HTMLElement)

    await waitFor(() => expect(revoked).toHaveLength(1))
  })

  it('sin integration_tokens.own ni access.admin muestra el 403 y ni pide el listado', async () => {
    const listRequests = mockBackend(meFixture({ role: 'viewer', capabilities: ['self.read'] }))
    renderWithProviders(<IntegrationTokensPage />)

    await screen.findByText('Tokens de integración')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Emitir token' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('web-tienda')).not.toBeInTheDocument()
    expect(listRequests).toHaveLength(0)
  })
})
