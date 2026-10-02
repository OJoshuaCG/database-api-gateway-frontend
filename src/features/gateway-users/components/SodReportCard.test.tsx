import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { SodReportCard } from './SodReportCard'

const API = 'http://localhost/api/v1'

const REPORT = {
  exceptions: [
    {
      id: 1,
      user: { id: 1, username: 'admin' },
      user_active: true,
      rule: 'owner_security_officer',
      kind: 'grandfathered',
      reason: 'grandfathered',
      since: '2026-10-02T10:00:00',
      expires_at: null,
      requested_by: null,
      approved_by: null,
      still_violating: true,
    },
    {
      id: 2,
      user: { id: 4, username: 'jperez' },
      user_active: true,
      rule: 'access_admin_security_officer',
      kind: 'override',
      reason: 'Incidente 4711: no hay otro security_officer',
      since: '2026-10-02T10:00:00',
      expires_at: '2026-10-03T10:00:00',
      requested_by: { id: 1, username: 'admin' },
      approved_by: null,
      still_violating: false,
    },
  ],
  uncovered: [
    { user: { id: 7, username: 'mlopez' }, user_active: false, rules: ['owner_security_officer'] },
  ],
}

function mockReport(data: unknown, status = 200) {
  server.use(
    http.get(`${API}/authz/sod-report`, () =>
      status === 200
        ? HttpResponse.json({ data })
        : HttpResponse.json(
            {
              detail: {
                msg: 'Prohibido',
                type: 'AppHttpException',
                public_context: { code: 'access.forbidden' },
              },
            },
            { status },
          ),
    ),
  )
}

describe('SodReportCard', () => {
  it('lista las cuentas sin excepción y las excepciones, con `still_violating` resaltado', async () => {
    mockReport(REPORT)
    renderWithProviders(<SodReportCard />)

    expect(await screen.findByText('1 cuenta combina funciones sin excepción')).toBeInTheDocument()
    // Cada fila existe dos veces en el DOM (tabla y tarjeta): `DataTable` oculta una por CSS.
    expect(screen.getAllByRole('link', { name: 'mlopez' })[0]).toHaveAttribute(
      'href',
      '/gateway-users/7/accesos',
    )
    expect(screen.getAllByText('Desactivada').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Heredada').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Combinación anterior a la regla.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sin vencimiento').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Emergencia').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Declaró admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sigue combinando').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ya separada').length).toBeGreaterThan(0)
    expect(screen.getByText('1 por resolver')).toBeInTheDocument()
  })

  it('sin nada que reportar muestra los dos estados vacíos', async () => {
    mockReport({ exceptions: [], uncovered: [] })
    renderWithProviders(<SodReportCard />)
    // Cada estado vacío existe dos veces (tabla y tarjeta), como las filas.
    expect(
      (await screen.findAllByText('Ninguna cuenta combina funciones sin excepción')).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('No hay excepciones vigentes').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un 403 muestra el estado de acceso compartido, sin «Reintentar»', async () => {
    mockReport(null, 403)
    renderWithProviders(<SodReportCard />)
    expect(
      await screen.findByText('No tenés acceso al reporte de separación de funciones'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })
})
