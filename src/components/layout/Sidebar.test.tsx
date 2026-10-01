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

describe('Sidebar — entradas según capacidades', () => {
  it('sin `gateway.admin` esconde usuarios del gateway y tokens; sin ejecutar SQL, la consola', async () => {
    mockMe(meFixture({ role: 'operator' }))
    renderWithProviders(<Sidebar />)
    // La sesión llega asíncrona: hasta entonces falla abierto y muestra todo.
    await screen.findByRole('link', { name: 'Servidores' })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Usuarios del gateway' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'Tokens de agente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Consola SQL' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bases de datos' })).toBeInTheDocument()
  })

  it('con `access_admin` y owner las muestra', async () => {
    mockMe(meFixture({ role: 'owner', global_capabilities: ['access_admin'] }))
    renderWithProviders(<Sidebar />)
    expect(await screen.findByRole('link', { name: 'Usuarios del gateway' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tokens de agente' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Consola SQL' })).toBeInTheDocument()
  })
})
