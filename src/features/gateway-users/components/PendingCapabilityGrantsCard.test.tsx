import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { GRANTS_CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { PendingCapabilityGrantsCard } from './PendingCapabilityGrantsCard'

const API = 'http://localhost/api/v1'

const DROP = 'Borrar bases de datos'

const DECIDABLE = {
  id: 12,
  user_id: 7,
  username: 'mlopez',
  capability: 'databases.drop',
  scope_type: 'server',
  scope_id: 9,
  scope_name: 'db-prod-01',
  status: 'pending',
  sensitive: true,
  requested_by: { id: 2, username: 'otra-admin' },
  requested_at: '2026-10-01T18:00:00Z',
  expires_at: '2026-10-08T18:00:00Z',
  request_reason: 'migración del viernes',
  implies: ['databases.read'],
  can_decide: true,
  blocked_reason: null,
}

const BLOCKED = {
  ...DECIDABLE,
  id: 13,
  username: 'jperez',
  user_id: 8,
  requested_by: { id: 1, username: 'admin' },
  can_decide: false,
  blocked_reason: 'access.self_approval_forbidden',
}

type Row = Record<string, unknown> & { id: number }

function mockBackend(rows: Row[]) {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({
        data: meFixture({ role: 'owner', global_capabilities: ['access_admin'] }),
      }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })),
    http.get(`${API}/capability-grants/pending`, () => HttpResponse.json({ data: rows })),
  )
}

/** El diálogo abierto, comprobando por su título cuál es (el `Modal` no lo ata como nombre). */
async function openDialog(title: string) {
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(title)).toBeInTheDocument()
  return dialog
}

/** Espera a que lleguen la bandeja Y el catálogo (las columnas se rehacen con él) y da el botón. */
async function rowButton(name: RegExp) {
  await screen.findAllByText(DROP)
  return (await screen.findAllByRole('button', { name }))[0] as HTMLElement
}

function errorBody(code: string, msg: string) {
  return { detail: { msg, type: 'AppHttpException', public_context: { code } } }
}

describe('PendingCapabilityGrantsCard', () => {
  it('lista persona, capacidad con su id, alcance, quién la pidió, motivo y vencimiento', async () => {
    mockBackend([DECIDABLE])
    renderWithProviders(<PendingCapabilityGrantsCard />)

    // Cada fila existe dos veces en el DOM (tabla y tarjeta): `DataTable` oculta una por CSS.
    expect((await screen.findAllByText('mlopez')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(DROP)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('databases.drop').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Servidor · db-prod-01').length).toBeGreaterThan(0)
    expect(screen.getAllByText('otra-admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Motivo: migración del viernes').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Incluye la lectura: Ver bases y su estructura.').length,
    ).toBeGreaterThan(0)
  })

  it('con can_decide=false deshabilita aprobar y rechazar y muestra el motivo, enlazado', async () => {
    mockBackend([BLOCKED])
    renderWithProviders(<PendingCapabilityGrantsCard />)

    const reason = (
      await screen.findAllByText(/No podés aprobar una capacidad que pediste vos/)
    )[0] as HTMLElement
    for (const name of [/^Aprobar:/, /^Rechazar:/]) {
      const button = screen.getAllByRole('button', { name })[0] as HTMLElement
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(reason.textContent ?? '')
    }
  })

  it('un código de bloqueo desconocido igual muestra un motivo (no deja un botón mudo)', async () => {
    mockBackend([{ ...BLOCKED, blocked_reason: 'access.algo_nuevo' }])
    renderWithProviders(<PendingCapabilityGrantsCard />)
    expect(
      (await screen.findAllByText(/No podés decidir esta solicitud ahora/)).length,
    ).toBeGreaterThan(0)
  })

  it('aprobar pide confirmación y envía el motivo recortado', async () => {
    mockBackend([DECIDABLE])
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/capability-grants/12/approve`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...DECIDABLE, status: 'active' } })
      }),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await userEvent.click(await rowButton(/^Aprobar:/))
    const dialog = await openDialog('¿Aprobar esta capacidad?')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), ' ok ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar capacidad' }))

    await waitFor(() => expect(bodies).toEqual([{ reason: 'ok' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rechazar sin motivo manda {} y rechazar con motivo lo envía', async () => {
    mockBackend([DECIDABLE])
    const bodies: unknown[] = []
    server.use(
      http.post(`${API}/capability-grants/12/reject`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...DECIDABLE, status: 'rejected' } })
      }),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await userEvent.click(await rowButton(/^Rechazar:/))
    let dialog = await openDialog('¿Rechazar esta solicitud?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }))
    await waitFor(() => expect(bodies).toEqual([{}]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(await rowButton(/^Rechazar:/))
    dialog = await openDialog('¿Rechazar esta solicitud?')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), 'no corresponde')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }))
    await waitFor(() => expect(bodies).toEqual([{}, { reason: 'no corresponde' }]))
  })

  it('un 409 tras una carrera queda en el diálogo, bloquea reintentar y refresca la bandeja', async () => {
    let listRequests = 0
    mockBackend([DECIDABLE])
    server.use(
      http.get(`${API}/capability-grants/pending`, () => {
        listRequests += 1
        return HttpResponse.json({ data: listRequests > 1 ? [] : [DECIDABLE] })
      }),
      http.post(`${API}/capability-grants/12/approve`, () =>
        HttpResponse.json(errorBody('access.grant_not_pending', 'ya no está pendiente'), {
          status: 409,
        }),
      ),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await userEvent.click(await rowButton(/^Aprobar:/))
    const dialog = await openDialog('¿Aprobar esta capacidad?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar capacidad' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /ya no está pendiente: otra persona la decidió/,
    )
    expect(within(dialog).getByRole('button', { name: 'Aprobar capacidad' })).toBeDisabled()
    // La bandeja se pidió de nuevo y la fila ya no está.
    await waitFor(() => expect(listRequests).toBeGreaterThan(1))
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: /^Aprobar:/ })).toHaveLength(0),
    )
  })

  it('un 404 al decidir muestra que la capacidad ya no existe', async () => {
    mockBackend([DECIDABLE])
    server.use(
      http.post(`${API}/capability-grants/12/reject`, () =>
        HttpResponse.json(errorBody('access.grant_not_found', 'no existe'), { status: 404 }),
      ),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await userEvent.click(await rowButton(/^Rechazar:/))
    const dialog = await openDialog('¿Rechazar esta solicitud?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/ya no existe/)
  })

  it('vacío: dice que no hay solicitudes', async () => {
    mockBackend([])
    renderWithProviders(<PendingCapabilityGrantsCard />)
    expect((await screen.findAllByText('No hay solicitudes pendientes')).length).toBeGreaterThan(0)
  })

  it('un 403 muestra el estado de acceso compartido, sin «Reintentar»', async () => {
    mockBackend([])
    server.use(
      http.get(`${API}/capability-grants/pending`, () =>
        HttpResponse.json(errorBody('access.forbidden', 'No tienes permiso.'), { status: 403 }),
      ),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)
    expect(
      await screen.findByText('No tenés acceso a las solicitudes pendientes'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })

  it('un error de carga ofrece «Reintentar»', async () => {
    mockBackend([])
    server.use(
      http.get(`${API}/capability-grants/pending`, () =>
        HttpResponse.json(errorBody('internal', 'falló'), { status: 500 }),
      ),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument()
  })
})
