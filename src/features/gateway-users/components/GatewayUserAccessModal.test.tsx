import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import type { GatewayUserOut } from '@/lib/contracts'
import { GLOBAL_CEILING_HINT } from '../grant-ceiling'
import { GatewayUserAccessModal } from './GatewayUserAccessModal'

const API = 'http://localhost/api/v1'

const target: GatewayUserOut = {
  id: 7,
  username: 'mlopez',
  email: 'mlopez@empresa.com',
  full_name: null,
  gateway_role: 'viewer',
  is_active: true,
  credential_set: true,
  global_capabilities: [],
  // Un permiso que supera el techo de quien edita, otorgado antes por otra persona: se tiene que
  // poder conservar, porque el backend solo mide lo que se AGREGA.
  scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

function mockBackend() {
  server.use(
    // Quien edita: operator con access_admin. No tiene security_officer ni llega a owner.
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({
        data: meFixture({ role: 'operator', global_capabilities: ['access_admin'] }),
      }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/authz/scope-readiness`, () =>
      HttpResponse.json({
        data: { total_databases: 0, unclassified_databases: 0, ready: true, servers: [] },
      }),
    ),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(9, 'db-prod-01')]))),
  )
}

/** El botón «Abrir lista» del combobox de rol de la fila `index`. */
function roleToggle(index: number) {
  const input = screen.getAllByRole('combobox', { name: 'Rol en ese alcance' })[index]
  const box = input?.parentElement
  if (!box) throw new Error(`falta el combobox de rol ${index}`)
  return within(box).getByRole('button', { name: 'Abrir lista' })
}

describe('GatewayUserAccessModal — techo de quien otorga', () => {
  it('deshabilita la global que el actor no tiene, con el motivo a la vista', async () => {
    mockBackend()
    renderWithProviders(<GatewayUserAccessModal user={target} onClose={() => undefined} />)
    const officer = await screen.findByRole('checkbox', { name: 'security_officer' })
    // El techo llega con `/auth/me`: hasta entonces no se sabe qué ocultar.
    await screen.findByText(/Solo podés otorgar hasta operator/)
    expect(officer).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'access_admin' })).toBeEnabled()
    expect(screen.getByText(new RegExp(GLOBAL_CEILING_HINT))).toBeInTheDocument()
  })

  it('un permiso nuevo no ofrece roles por encima del techo; el existente conserva el suyo', async () => {
    mockBackend()
    renderWithProviders(<GatewayUserAccessModal user={target} onClose={() => undefined} />)
    await screen.findByText(/Solo podés otorgar hasta operator/)

    await userEvent.click(roleToggle(0))
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Añadir permiso' }))
    await userEvent.click(roleToggle(1))
    expect(screen.getByRole('option', { name: 'operator' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'owner' })).not.toBeInTheDocument()
  })

  it('muestra el acceso efectivo al guardar, con la línea de diferencia por permiso', async () => {
    mockBackend()
    renderWithProviders(<GatewayUserAccessModal user={target} onClose={() => undefined} />)
    expect(await screen.findByText('Acceso efectivo al guardar')).toBeInTheDocument()
    // El título no repite la procedencia («Permiso de entorno»): ya la dice el badge.
    expect((await screen.findAllByText('Producción · owner')).length).toBeGreaterThan(0)
    // La misma diferencia aparece bajo la fila del permiso y en el panel efectivo.
    expect(screen.getAllByText(/suma 14|Suma 14/).length).toBeGreaterThanOrEqual(2)
  })
})
