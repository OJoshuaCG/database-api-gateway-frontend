import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { ApiTokensPage } from './ApiTokensPage'

const API = 'http://localhost/api/v1'

// El catálogo de fixtures es anterior a `tokens.own`, así que la capacidad se pasa por
// `capabilities` en vez de esperar que `meFixture` la derive del rol.
const OWN_TOKENS_ONLY = ['self.read', 'tokens.own', 'blueprints.read']

function tokenRow(id: number, name: string) {
  return {
    id,
    token_id: `tok${id}`,
    name,
    scopes: ['blueprints.read'],
    project_id: 4,
    expires_at: '2099-01-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    note: null,
    active: true,
    created_at: '2026-09-09T12:00:00Z',
  }
}

const pagination = { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false }

/** Devuelve el contador de pedidos al listado y las URLs, para verificar que no filtra el cliente. */
function mockBackend(me: Record<string, unknown>, rows = [tokenRow(1, 'mi-token')]) {
  const listRequests: URL[] = []
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/api-tokens`, ({ request }) => {
      listRequests.push(new URL(request.url))
      return HttpResponse.json({ data: rows, pagination })
    }),
  )
  return listRequests
}

describe('ApiTokensPage — autoservicio con tokens.own', () => {
  it('quien tiene tokens.own sin access.admin ve la pantalla, la lista y puede emitir', async () => {
    const listRequests = mockBackend(meFixture({ role: 'viewer', capabilities: OWN_TOKENS_ONLY }))
    renderWithProviders(<ApiTokensPage />)

    expect(await screen.findAllByText('mi-token')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeInTheDocument()
    expect(listRequests).toHaveLength(1)
  })

  it('muestra lo que devuelve el servidor y no filtra ni manda el dueño desde el cliente', async () => {
    // El servidor ya devolvió solo los propios: la SPA no recorta, no reordena por dueño ni pide
    // «mine=true». Si algún día lo hiciera, el filtro dejaría de ser la barrera que es hoy.
    const listRequests = mockBackend(meFixture({ role: 'viewer', capabilities: OWN_TOKENS_ONLY }), [
      tokenRow(1, 'propio-uno'),
      tokenRow(2, 'propio-dos'),
    ])
    renderWithProviders(<ApiTokensPage />)

    expect(await screen.findAllByText('propio-uno')).not.toHaveLength(0)
    expect(screen.getAllByText('propio-dos')).not.toHaveLength(0)
    const [request] = listRequests
    expect([...(request?.searchParams.keys() ?? [])].sort()).toEqual(['page', 'size'])
  })

  it('avisa que solo se ven los tokens propios; access.admin ve el texto general', async () => {
    mockBackend(meFixture({ role: 'viewer', capabilities: OWN_TOKENS_ONLY }))
    const own = renderWithProviders(<ApiTokensPage />)
    expect(await screen.findByText(/solo los tokens que emitiste vos/)).toBeInTheDocument()
    own.unmount()

    mockBackend(meFixture({ role: 'owner', global_capabilities: ['access_admin'] }))
    renderWithProviders(<ApiTokensPage />)
    await screen.findAllByText('mi-token')
    expect(screen.queryByText(/solo los tokens que emitiste vos/)).not.toBeInTheDocument()
  })

  it('sin tokens.own ni access.admin muestra el 403 compartido y ni pide el listado', async () => {
    const listRequests = mockBackend(meFixture({ role: 'viewer', capabilities: ['self.read'] }))
    renderWithProviders(<ApiTokensPage />)

    await screen.findByText('Tokens de agente')
    // Antes de que llegue la sesión `can()` falla abierto a propósito, así que el botón existe un
    // instante: se espera a que la sesión cargue y recién ahí se comprueba que desaparece.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Emitir token' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('mi-token')).not.toBeInTheDocument()
    expect(listRequests).toHaveLength(0)
  })
})
