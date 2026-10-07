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

// El catálogo de fixtures es anterior a `tokens.own`: la capacidad se pasa explícita.
describe('Sidebar — «Tokens de agente» con tokens.own', () => {
  it('quien tiene tokens.own sin access.admin ve la entrada, pero no «Usuarios del gateway»', async () => {
    mockMe(meFixture({ role: 'viewer', capabilities: ['self.read', 'tokens.own', 'servers.read'] }))
    renderWithProviders(<Sidebar />)

    expect(await screen.findByRole('link', { name: 'Tokens de agente' })).toHaveAttribute(
      'href',
      '/api-tokens',
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Usuarios del gateway' })).not.toBeInTheDocument(),
    )
  })

  it('sin tokens.own ni access.admin esconde la entrada', async () => {
    mockMe(meFixture({ role: 'viewer', capabilities: ['self.read', 'servers.read'] }))
    renderWithProviders(<Sidebar />)

    await screen.findByRole('link', { name: 'Servidores' })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Tokens de agente' })).not.toBeInTheDocument(),
    )
  })
})
