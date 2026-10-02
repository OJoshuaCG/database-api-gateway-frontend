import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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
import { PendingAccessRequestsCard } from './PendingAccessRequestsCard'

const API = 'http://localhost/api/v1'

/** La persona destino HOY: viewer, sin globales, viewer en Producción. */
const TARGET = {
  id: 7,
  username: 'mlopez',
  email: 'mlopez@empresa.com',
  full_name: null,
  gateway_role: 'viewer',
  is_active: true,
  credential_set: true,
  global_capabilities: [],
  scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

const DECIDABLE = {
  id: 21,
  target: { id: 7, username: 'mlopez' },
  requested_by: { id: 2, username: 'otra-admin' },
  status: 'pending',
  origin: 'set_access',
  desired: {
    gateway_role: 'viewer',
    global_capabilities: ['access_admin'],
    scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
  },
  elevations: [
    { kind: 'global_capability', global_capability: 'access_admin' },
    { kind: 'scope_grant', scope_type: 'environment', scope_id: 3, role: 'owner' },
  ],
  sod_override: null,
  created_at: '2026-10-01T18:00:00Z',
  expires_at: '2026-10-08T18:00:00Z',
  decided_by: null,
  decided_at: null,
  reason: null,
  can_decide: true,
  blocked_reason: null,
}

/** Pedida por quien mira (id 1): no la puede decidir, sí cancelar. */
const OWN = {
  ...DECIDABLE,
  id: 22,
  requested_by: { id: 1, username: 'admin' },
  can_decide: false,
  blocked_reason: 'access.self_approval_forbidden',
}

type Row = Record<string, unknown> & { id: number }

function mockBackend(rows: Row[]) {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({
        data: {
          ...meFixture({ role: 'viewer', global_capabilities: ['access_admin'] }),
          id: 1,
          username: 'admin',
        },
      }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/access-requests/pending`, () => HttpResponse.json({ data: rows })),
    http.get(`${API}/gateway-users/7`, () => HttpResponse.json({ data: TARGET })),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(pageOf([environmentFixture(3, 'Producción', 2)])),
    ),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(9, 'db-prod-01')]))),
  )
}

function errorBody(code: string, msg: string) {
  return { detail: { msg, type: 'AppHttpException', public_context: { code } } }
}

async function openDialog(title: string) {
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(title)).toBeInTheDocument()
  return dialog
}

/** Espera la fila y da el primer botón (la fila existe dos veces: tabla y tarjeta). */
async function rowButton(name: RegExp) {
  return (await screen.findAllByRole('button', { name }))[0] as HTMLElement
}

describe('PendingAccessRequestsCard', () => {
  it('muestra la diferencia actual → pedido, compacta, con lo que eleva marcado', async () => {
    mockBackend([DECIDABLE])
    renderWithProviders(<PendingAccessRequestsCard />)

    expect((await screen.findAllByText('mlopez')).length).toBeGreaterThan(0)
    // Contra el acceso de HOY (GET /gateway-users/7): viewer → owner en Producción.
    expect((await screen.findAllByText('viewer → owner')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Entorno Producción:').length).toBeGreaterThan(0)
    expect(screen.getAllByText('no la tiene → la tiene').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Requiere segundo aprobador').length).toBeGreaterThan(0)
    expect(screen.getAllByText('otra-admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cambio de accesos').length).toBeGreaterThan(0)
    // La pidió otra persona: no se ofrece cancelar.
    expect(screen.queryAllByRole('button', { name: /^Cancelar:/ })).toHaveLength(0)
  })

  it('la propia: aprobar y rechazar deshabilitados con el motivo enlazado, y «Cancelar» habilitado', async () => {
    mockBackend([OWN])
    renderWithProviders(<PendingAccessRequestsCard />)

    const reason = (
      await screen.findAllByText(/No podés aprobar una elevación que pediste vos/)
    )[0] as HTMLElement
    for (const name of [/^Aprobar:/, /^Rechazar:/]) {
      const button = screen.getAllByRole('button', { name })[0] as HTMLElement
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(reason.textContent ?? '')
    }
    expect(await rowButton(/^Cancelar:/)).toBeEnabled()
  })

  it('aprobar pide confirmación, muestra el cambio y envía el motivo recortado', async () => {
    mockBackend([DECIDABLE])
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/access-requests/21/approve`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...DECIDABLE, status: 'applied' } })
      }),
    )
    renderWithProviders(<PendingAccessRequestsCard />)

    await userEvent.click(await rowButton(/^Aprobar:/))
    const dialog = await openDialog('¿Aprobar esta elevación?')
    expect(within(dialog).getByText(/se cierran sus sesiones/)).toBeInTheDocument()
    expect(await within(dialog).findByText('viewer → owner')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), ' ok ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar elevación' }))

    await waitFor(() => expect(bodies).toEqual([{ reason: 'ok' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rechazar sin motivo manda {}', async () => {
    mockBackend([DECIDABLE])
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/access-requests/21/reject`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...DECIDABLE, status: 'rejected' } })
      }),
    )
    renderWithProviders(<PendingAccessRequestsCard />)

    await userEvent.click(await rowButton(/^Rechazar:/))
    const dialog = await openDialog('¿Rechazar esta elevación?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar elevación' }))
    await waitFor(() => expect(bodies).toEqual([{}]))
  })

  it('cancelar la propia llama a /cancel', async () => {
    mockBackend([OWN])
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/access-requests/22/cancel`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...OWN, status: 'cancelled' } })
      }),
    )
    renderWithProviders(<PendingAccessRequestsCard />)

    await userEvent.click(await rowButton(/^Cancelar:/))
    const dialog = await openDialog('¿Cancelar tu solicitud?')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), 'me equivoqué')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar solicitud' }))
    await waitFor(() => expect(bodies).toEqual([{ reason: 'me equivoqué' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('un 409 `request_stale` queda en el diálogo, bloquea reintentar y refresca la bandeja', async () => {
    let listRequests = 0
    mockBackend([DECIDABLE])
    server.use(
      http.get(`${API}/access-requests/pending`, () => {
        listRequests += 1
        return HttpResponse.json({ data: listRequests > 1 ? [] : [DECIDABLE] })
      }),
      http.post(`${API}/access-requests/21/approve`, () =>
        HttpResponse.json(errorBody('access.request_stale', 'vieja'), { status: 409 }),
      ),
    )
    renderWithProviders(<PendingAccessRequestsCard />)

    await userEvent.click(await rowButton(/^Aprobar:/))
    const dialog = await openDialog('¿Aprobar esta elevación?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar elevación' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /cambió desde que se pidió esta elevación/,
    )
    expect(within(dialog).getByRole('button', { name: 'Aprobar elevación' })).toBeDisabled()
    await waitFor(() => expect(listRequests).toBeGreaterThan(1))
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: /^Aprobar:/ })).toHaveLength(0),
    )
  })

  it('un 404 al decidir dice que la solicitud ya no existe', async () => {
    mockBackend([DECIDABLE])
    server.use(
      http.post(`${API}/access-requests/21/reject`, () =>
        HttpResponse.json(errorBody('access.request_not_found', 'no existe'), { status: 404 }),
      ),
    )
    renderWithProviders(<PendingAccessRequestsCard />)

    await userEvent.click(await rowButton(/^Rechazar:/))
    const dialog = await openDialog('¿Rechazar esta elevación?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar elevación' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/ya no existe/)
  })

  it('vacío: dice que no hay elevaciones pendientes', async () => {
    mockBackend([])
    renderWithProviders(<PendingAccessRequestsCard />)
    expect((await screen.findAllByText('No hay elevaciones pendientes')).length).toBeGreaterThan(0)
  })

  it('un 403 muestra el estado de acceso compartido, sin «Reintentar»', async () => {
    mockBackend([])
    server.use(
      http.get(`${API}/access-requests/pending`, () =>
        HttpResponse.json(errorBody('access.forbidden', 'No tienes permiso.'), { status: 403 }),
      ),
    )
    renderWithProviders(<PendingAccessRequestsCard />)
    expect(
      await screen.findByText('No tenés acceso a las elevaciones pendientes'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })
})
