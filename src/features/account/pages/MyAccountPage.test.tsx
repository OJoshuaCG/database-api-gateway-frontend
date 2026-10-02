import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  GRANTS_CATALOG_FIXTURE,
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
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })),
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

  it('suma las capacidades puntuales propias y nombra las pendientes sin contarlas', async () => {
    mockBackend({
      ...meFixture({ role: 'viewer' }),
      capability_grants: [
        {
          id: 4,
          capability: 'databases.write',
          scope_type: 'server',
          scope_id: 9,
          scope_name: 'db-prod-01',
          status: 'active',
        },
        {
          id: 5,
          capability: 'exports.download',
          scope_type: 'environment',
          scope_id: 3,
          scope_name: null,
          status: 'pending',
          expires_at: '2026-10-08T00:00:00Z',
        },
      ],
    })
    renderWithProviders(<MyAccountPage />, { route: '/mi-cuenta' })
    expect(
      await screen.findByText('Crear y editar bases gestionadas · db-prod-01'),
    ).toBeInTheDocument()
    expect(screen.getByText('Puntual')).toBeInTheDocument()
    // La pendiente no es una fila de acceso: solo una línea que dice que todavía no concede nada.
    expect(screen.queryByText(/Descargar los datos exportados en claro ·/)).not.toBeInTheDocument()
    expect(screen.getByText(/Tenés 1 solicitud de capacidad puntual pendiente/)).toHaveTextContent(
      'Descargar los datos exportados en claro',
    )
  })
})
