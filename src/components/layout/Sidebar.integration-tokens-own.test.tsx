import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { Sidebar } from './Sidebar'

function mockMe(me: Record<string, unknown>) {
  server.use(http.get('http://localhost/api/v1/auth/me', () => HttpResponse.json({ data: me })))
}

// El catálogo de fixtures es anterior a `integration_tokens.own`: la capacidad se pasa explícita.
describe('Sidebar — «Tokens de integración» con integration_tokens.own', () => {
  it('quien tiene integration_tokens.own ve la entrada', async () => {
    mockMe(
      meFixture({
        role: 'viewer',
        capabilities: ['self.read', 'integration_tokens.own', 'servers.read'],
      }),
    )
    renderWithProviders(<Sidebar />)

    expect(await screen.findByRole('link', { name: 'Tokens de integración' })).toHaveAttribute(
      'href',
      '/integration-tokens',
    )
  })

  it('sin integration_tokens.own ni access.admin esconde la entrada', async () => {
    mockMe(meFixture({ role: 'viewer', capabilities: ['self.read', 'servers.read'] }))
    renderWithProviders(<Sidebar />)

    await screen.findByRole('link', { name: 'Servidores' })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Tokens de integración' })).not.toBeInTheDocument(),
    )
  })
})
