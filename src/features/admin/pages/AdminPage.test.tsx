import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { AdminPage } from './AdminPage'

const API = 'http://localhost/api/v1'

function mockBackend(me: Record<string, unknown>) {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/privileges`, () => HttpResponse.json({ data: [] })),
  )
}

/** Pinta la dirección actual, para afirmar sobre la redirección. */
function LocationProbe() {
  const location = useLocation()
  return <output aria-label="ubicación">{`${location.pathname}${location.search}`}</output>
}

describe('AdminPage', () => {
  it('el enlace viejo a «Mis sesiones» redirige a «Mi cuenta»', async () => {
    mockBackend(meFixture({ role: 'owner', global_capabilities: ['access_admin'] }))
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mi-cuenta" element={<LocationProbe />} />
      </Routes>,
      { route: '/admin?tab=sessions' },
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'ubicación' })).toHaveTextContent(
        '/mi-cuenta?tab=sesiones',
      ),
    )
  })

  it('sin `crypto.rotate` no ofrece «Cifrado» y arranca en «Privilegios»', async () => {
    mockBackend(meFixture({ role: 'owner' }))
    renderWithProviders(<AdminPage />, { route: '/admin' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Privilegios' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByRole('tab', { name: 'Cifrado' })).not.toBeInTheDocument()
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Secciones de administración')
  })

  it('con `crypto.rotate` (security_officer) arranca en «Cifrado»', async () => {
    mockBackend(meFixture({ role: 'viewer', global_capabilities: ['security_officer'] }))
    renderWithProviders(<AdminPage />, { route: '/admin' })
    expect(await screen.findByRole('tab', { name: 'Cifrado' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('access_admin no tiene `crypto.rotate`: no ofrece «Cifrado»', async () => {
    mockBackend(meFixture({ role: 'owner', global_capabilities: ['access_admin'] }))
    renderWithProviders(<AdminPage />, { route: '/admin' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Privilegios' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByRole('tab', { name: 'Cifrado' })).not.toBeInTheDocument()
  })
})
