import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { GRANTS_CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import type { ServerUserOut } from '@/lib/contracts'
import { GrantPanel } from './GrantPanel'

const API = 'http://localhost/api/v1'

const USER: ServerUserOut = {
  id: 7,
  server_id: 1,
  username: 'app_rw',
  host: '%',
  is_active: true,
  has_password: true,
  notes: null,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
}

function privilege(id: number, name: string, isSensitive: boolean) {
  return {
    id,
    engine: 'mysql',
    name,
    category: 'data',
    context: null,
    description: name,
    is_sensitive: isSensitive,
    is_active: true,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  }
}

/** Sesión del rol dado + todo lo que `GrantPanel` pide al montarse (el servidor falla ante lo no mockeado). */
function mockBackend(role: string) {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })),
    http.get(`${API}/privileges`, () =>
      HttpResponse.json({
        data: [privilege(1, 'SELECT', false), privilege(2, 'ALL PRIVILEGES', true)],
      }),
    ),
    http.get(`${API}/permission-profiles`, () => HttpResponse.json({ data: [] })),
    http.get(`${API}/servers/1/databases`, () => HttpResponse.json({ data: ['shop'] })),
  )
}

describe('GrantPanel: delegar privilegios pide engine_users.grant_admin', () => {
  it('operator: WITH GRANT OPTION queda deshabilitado con el motivo a la vista', async () => {
    mockBackend('operator')
    renderWithProviders(<GrantPanel user={USER} engine="mysql" />)

    // El motivo aparece junto al interruptor y junto a los privilegios (que esconden los sensibles).
    const hints = await screen.findAllByText(
      /Tu acceso no permite otorgar con WITH GRANT OPTION o privilegios sensibles/,
    )
    expect(hints.length).toBeGreaterThan(0)
    for (const hint of hints) expect(hint).toHaveTextContent('engine_users.grant_admin')
    expect(screen.getByRole('switch', { name: 'WITH GRANT OPTION' })).toBeDisabled()
  })

  it('owner: WITH GRANT OPTION habilitado y sin ningún motivo', async () => {
    mockBackend('owner')
    renderWithProviders(<GrantPanel user={USER} engine="mysql" />)

    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: 'WITH GRANT OPTION' })).toBeEnabled(),
    )
    expect(
      screen.queryAllByText(/Tu acceso no permite otorgar con WITH GRANT OPTION/),
    ).toHaveLength(0)
    expect(screen.getByText(/Permite al usuario re-delegar estos privilegios/)).toBeInTheDocument()
  })
})
