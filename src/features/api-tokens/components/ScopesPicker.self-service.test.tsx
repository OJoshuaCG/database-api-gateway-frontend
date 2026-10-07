import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { ScopesPicker } from './ScopesPicker'

const API = 'http://localhost/api/v1'
const OFFERED = ['blueprints.read', 'databases.read', 'data.read']

function mockMe(me: Record<string, unknown>) {
  server.use(http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })))
}

function renderPicker() {
  return renderWithProviders(
    <ScopesPicker
      value={[]}
      onChange={() => undefined}
      ceiling={{ offered: OFFERED, discovered: false, discover: () => undefined }}
      description="ayuda"
    />,
  )
}

describe('ScopesPicker — autoservicio', () => {
  it('quien no es access.admin no puede ofrecer lo que su rol no tiene (data.read de un viewer)', async () => {
    mockMe(
      meFixture({
        role: 'viewer',
        capabilities: ['self.read', 'tokens.own', 'blueprints.read', 'databases.read'],
      }),
    )
    renderPicker()

    await waitFor(() => expect(screen.getByRole('button', { name: 'data.read' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'blueprints.read' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'databases.read' })).toBeEnabled()
  })

  it('un owner de autoservicio sí puede ofrecer data.read', async () => {
    mockMe(
      meFixture({
        role: 'owner',
        capabilities: ['self.read', 'tokens.own', 'blueprints.read', 'databases.read', 'data.read'],
      }),
    )
    renderPicker()

    await waitFor(() => expect(screen.getByRole('button', { name: 'data.read' })).toBeEnabled())
  })

  it('access.admin conserva todos los chips (el servidor acepta lo inerte)', async () => {
    mockMe(
      meFixture({
        role: 'viewer',
        global_capabilities: ['access_admin'],
        capabilities: ['self.read', 'access.admin', 'blueprints.read'],
      }),
    )
    renderPicker()

    await waitFor(() => expect(screen.getByRole('button', { name: 'data.read' })).toBeEnabled())
  })
})
