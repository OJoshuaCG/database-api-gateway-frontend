import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { ApiTokensPage } from './ApiTokensPage'

const API = 'http://localhost/api/v1'

function tokenRow(id: number, name: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

const pagination = { page: 1, size: 20, total: 2, pages: 1, has_next: false, has_prev: false }

function mockBackend(globals: string[]) {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({ data: meFixture({ global_capabilities: globals }) }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/api-tokens`, () =>
      HttpResponse.json({
        data: [
          tokenRow(1, 'ci-activo'),
          tokenRow(2, 'ci-revocado', { active: false, revoked_at: '2026-09-10T10:00:00Z' }),
        ],
        pagination,
      }),
    ),
  )
}

describe('ApiTokensPage — editar permisos', () => {
  it('con access.admin ofrece editar solo en los tokens activos y abre el modal', async () => {
    mockBackend(['access_admin'])
    const user = userEvent.setup()
    renderWithProviders(<ApiTokensPage />)

    // La página dibuja la tabla de escritorio y las tarjetas móviles a la vez (el CSS decide cuál
    // se ve), así que el mismo botón aparece dos veces en el DOM.
    const edits = await screen.findAllByRole('button', { name: 'Editar permisos de ci-activo' })
    expect(
      screen.queryByRole('button', { name: 'Editar permisos de ci-revocado' }),
    ).not.toBeInTheDocument()

    await user.click(edits[0] as HTMLElement)
    expect(await screen.findByText('Permisos de «ci-activo»')).toBeInTheDocument()
  })

  it('sin access.admin no ofrece editar ni listar', async () => {
    mockBackend([])
    renderWithProviders(<ApiTokensPage />)

    await screen.findByText('Tokens de agente')
    expect(screen.queryByRole('button', { name: /Editar permisos de/ })).not.toBeInTheDocument()
    expect(screen.queryByText('ci-activo')).not.toBeInTheDocument()
  })
})
