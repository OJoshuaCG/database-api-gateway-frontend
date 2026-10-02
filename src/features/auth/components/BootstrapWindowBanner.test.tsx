import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { formatSodInstant } from '../separation-of-duties'
import { BootstrapWindowBanner } from './BootstrapWindowBanner'

const API = 'http://localhost/api/v1'

function mockMe(bootstrapWindow: unknown, globals: string[] = ['access_admin']) {
  let requests = 0
  server.use(
    http.get(`${API}/auth/me`, () => {
      requests += 1
      const me = meFixture({ role: 'viewer', global_capabilities: globals })
      return HttpResponse.json({
        data: bootstrapWindow === undefined ? me : { ...me, bootstrap_window: bootstrapWindow },
      })
    }),
  )
  return { requests: () => requests }
}

describe('BootstrapWindowBanner', () => {
  it('abierta: muestra el vencimiento en hora local, el procedimiento y el enlace', async () => {
    mockMe({ open: true, closes_at: '2026-10-05T17:00:00' })
    renderWithProviders(<BootstrapWindowBanner />)
    expect(await screen.findByText('Ventana de arranque abierta')).toBeInTheDocument()
    const body = screen.getByText(/Mientras seas el único administrador de accesos/)
    // UTC sin zona: se formatea como el mismo instante que con la `Z`, no como hora local.
    expect(body).toHaveTextContent(
      `Ventana de arranque abierta hasta el ${formatSodInstant('2026-10-05T17:00:00Z')}.`,
    )
    expect(body).toHaveTextContent(/cuando este acepte su invitación, la ventana se cierra/)
    expect(screen.getByRole('link', { name: 'Ir a usuarios del gateway' })).toHaveAttribute(
      'href',
      '/gateway-users',
    )
    // Es un estado, no una notificación: no se puede descartar.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('abierta sin `closes_at`: omite la fecha en vez de inventarla', async () => {
    mockMe({ open: true, closes_at: null })
    renderWithProviders(<BootstrapWindowBanner />)
    const body = await screen.findByText(/Mientras seas el único administrador de accesos/)
    expect(body).toHaveTextContent(/^Ventana de arranque abierta\. Mientras/)
  })

  it('cerrada, `null`, sin el campo o sin `access.admin`: no pinta nada', async () => {
    const cases: { window: unknown; globals?: string[] }[] = [
      { window: { open: false, closes_at: '2026-10-05T17:00:00' } },
      { window: null },
      { window: undefined },
      { window: { open: true, closes_at: '2026-10-05T17:00:00' }, globals: [] },
    ]
    for (const { window, globals } of cases) {
      const backend = mockMe(window, globals)
      const { unmount } = renderWithProviders(<BootstrapWindowBanner />)
      await waitFor(() => expect(backend.requests()).toBeGreaterThan(0))
      expect(screen.queryByText(/Ventana de arranque/)).not.toBeInTheDocument()
      unmount()
    }
  })
})
