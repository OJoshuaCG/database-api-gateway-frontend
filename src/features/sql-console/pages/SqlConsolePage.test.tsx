import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { SqlConsolePage } from './SqlConsolePage'

const emptyPage = { page: 1, size: 100, total: 0, pages: 0, has_next: false, has_prev: false }

function mockSession(me: Record<string, unknown>) {
  server.use(
    http.get('http://localhost/api/v1/auth/me', () => HttpResponse.json({ data: me })),
    http.get('http://localhost/api/v1/authz/catalog', () =>
      HttpResponse.json({ data: CATALOG_FIXTURE }),
    ),
    http.get('http://localhost/api/v1/servers', () =>
      HttpResponse.json({ data: [], pagination: emptyPage }),
    ),
  )
}

describe('SqlConsolePage — sin `sql_console.execute`', () => {
  it('sin `?tab`, quien solo ve el historial entra a «Historial» y no se le promete ejecutar', async () => {
    mockSession(meFixture({ role: 'viewer' }))
    renderWithProviders(<SqlConsolePage />, { route: '/sql-console' })

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Historial/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.getByRole('tab', { name: /Consola/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText(/Ejecutá SQL contra cualquier base/)).not.toBeInTheDocument()
  })

  it('con `sql_console.execute`, la pestaña por defecto sigue siendo la consola', async () => {
    mockSession(meFixture({ role: 'owner' }))
    renderWithProviders(<SqlConsolePage />, { route: '/sql-console' })

    expect(await screen.findByText(/Ejecutá SQL contra cualquier base/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Consola/ })).toHaveAttribute('aria-selected', 'true')
  })
})
