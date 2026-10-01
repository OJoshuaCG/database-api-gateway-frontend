import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  CATALOG_FIXTURE,
  environmentFixture,
  meFixture,
  pageOf,
  serverFixture,
} from '@/test/fixtures/authz-catalog'
import { SCOPE_ENFORCEMENT_NOTE } from '@/features/auth'
import { MyAccountPage } from './MyAccountPage'

const API = 'http://localhost/api/v1'

function mockBackend(me: Record<string, unknown>) {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(pageOf([environmentFixture(3, 'Producción', 2)])),
    ),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(9, 'db-prod-01')]))),
  )
}

describe('MyAccountPage — «Mi acceso»', () => {
  it('muestra el rol base, cada permiso con su destino por nombre y la nota honesta', async () => {
    mockBackend(
      meFixture({
        role: 'operator',
        base_role: 'operator',
        scope_roles: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
      }),
    )
    renderWithProviders(<MyAccountPage />, { route: '/mi-cuenta' })
    expect(await screen.findByText('operator · 17 capacidades')).toBeInTheDocument()
    expect(await screen.findByText('Producción · viewer')).toBeInTheDocument()
    expect(screen.getByText(SCOPE_ENFORCEMENT_NOTE)).toBeInTheDocument()
    // Es de solo lectura: nada para guardar.
    expect(screen.queryByRole('button', { name: /Guardar/ })).not.toBeInTheDocument()
  })

  it('sin permisos por alcance lo dice en una línea', async () => {
    mockBackend(meFixture({ role: 'viewer' }))
    renderWithProviders(<MyAccountPage />, { route: '/mi-cuenta' })
    expect(
      await screen.findByText(/en todo el gateway, sin permisos por alcance/),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Mi acceso' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Secciones de mi cuenta')
    // La matriz es `self.read`: enlazada desde acá para ver qué otorgaría otro rol.
    expect(screen.getByRole('link', { name: 'Ver qué otorga cada rol' })).toHaveAttribute(
      'href',
      '/gateway-users?tab=roles',
    )
  })
})
