import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setStepUpHandler } from '@/lib/api/client'
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

  it('vacío: dice que no hay capacidades pendientes', async () => {
    mockBackend([])
    renderWithProviders(<PendingCapabilityGrantsCard />)
    expect(
      (await screen.findAllByText('No hay capacidades puntuales pendientes')).length,
    ).toBeGreaterThan(0)
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

// ── Decisión masiva ────────────────────────────────────────────────────────────
const SECOND = {
  ...DECIDABLE,
  id: 14,
  username: 'agarcia',
  user_id: 9,
  scope_id: 10,
  scope_name: 'db-prod-02',
}

const THIRD = {
  ...DECIDABLE,
  id: 15,
  username: 'rdiaz',
  user_id: 10,
  scope_id: 11,
  scope_name: 'db-prod-03',
}

type BulkBody = { decision: string; ids: number[]; reason?: string }

/** Casilla de la fila de `username` (la fila existe dos veces: tabla y tarjeta; ambas comparten estado). */
async function rowCheckbox(username: string) {
  await screen.findAllByText(DROP)
  return (
    await screen.findAllByRole('checkbox', {
      name: new RegExp(`^Seleccionar: .* de ${username} en `),
    })
  )[0] as HTMLInputElement
}

function decidedItem(row: Row) {
  return { id: row.id, ok: true, grant: { ...row, status: 'active' } }
}

/**
 * Bandeja con estado: `POST /decisions` aplica `outcome` y saca de la lista a las decididas, como
 * haría el backend, para comprobar que la fila sale y la que falló se queda.
 */
function mockBulkBackend(
  rows: Row[],
  outcome: (body: BulkBody) => { results: unknown[]; decidedIds: number[] },
) {
  const state = { rows, bodies: [] as BulkBody[] }
  mockBackend([])
  server.use(
    http.get(`${API}/capability-grants/pending`, () => HttpResponse.json({ data: state.rows })),
    http.post(`${API}/capability-grants/decisions`, async ({ request }) => {
      const body = (await request.json()) as BulkBody
      state.bodies.push(body)
      const { results, decidedIds } = outcome(body)
      state.rows = state.rows.filter((row) => !decidedIds.includes(row.id))
      const succeeded = decidedIds.length
      return HttpResponse.json({
        data: {
          requested: body.ids.length,
          succeeded,
          failed: body.ids.length - succeeded,
          results,
        },
        message: `${succeeded} de ${body.ids.length} solicitudes decididas.`,
      })
    }),
  )
  return state
}

describe('PendingCapabilityGrantsCard: decisión masiva', () => {
  afterEach(() => {
    setStepUpHandler(null)
  })

  it('elegir una fila muestra la barra con el conteo y desmarcarla la esconde', async () => {
    mockBulkBackend([DECIDABLE, SECOND], () => ({ results: [], decidedIds: [] }))
    renderWithProviders(<PendingCapabilityGrantsCard />)

    expect(screen.queryByRole('region', { name: /Acciones sobre las solicitudes/ })).toBeNull()
    const box = await rowCheckbox('mlopez')
    await userEvent.click(box)

    const bar = screen.getByRole('region', { name: /Acciones sobre las solicitudes/ })
    expect(within(bar).getByText('1 seleccionada')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Aprobar 1' })).toBeEnabled()
    expect(within(bar).getByRole('button', { name: 'Rechazar 1' })).toBeEnabled()

    await userEvent.click(box)
    expect(screen.queryByRole('region', { name: /Acciones sobre las solicitudes/ })).toBeNull()
  })

  it('«Seleccionar todas» solo toma las que can_decide permite y las bloqueadas quedan deshabilitadas con su motivo', async () => {
    mockBulkBackend([DECIDABLE, BLOCKED, SECOND], () => ({ results: [], decidedIds: [] }))
    renderWithProviders(<PendingCapabilityGrantsCard />)
    await screen.findAllByText(DROP)

    const all = await screen.findByRole('checkbox', { name: 'Seleccionar todas (2)' })
    expect(screen.getByText('1 no se puede decidir y queda fuera.')).toBeInTheDocument()
    await userEvent.click(all)

    const bar = screen.getByRole('region', { name: /Acciones sobre las solicitudes/ })
    expect(within(bar).getByText('2 seleccionadas')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Aprobar 2' })).toBeInTheDocument()

    const blockedBox = (
      await screen.findAllByRole('checkbox', { name: /^Seleccionar: .* de jperez en / })
    )[0] as HTMLInputElement
    expect(blockedBox).toBeDisabled()
    expect(blockedBox).not.toBeChecked()
    // El motivo visible es el mismo que el de los botones de la fila.
    expect(blockedBox).toHaveAccessibleDescription(/No podés aprobar una capacidad que pediste vos/)
  })

  it('aprobar el lote pide UNA confirmación con el conteo, manda el cuerpo y resume «n de N»', async () => {
    const state = mockBulkBackend([DECIDABLE, SECOND], (body) => ({
      decidedIds: body.ids,
      results: [decidedItem(DECIDABLE), decidedItem(SECOND)],
    }))
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await screen.findAllByText(DROP)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar todas (2)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 2' }))

    const dialog = await openDialog('¿Aprobar 2 capacidades?')
    // El lote se nombra completo en el diálogo y el recordatorio de lo sensible está a la vista.
    expect(within(dialog).getByText(/Son sensibles \(exclusivas de owner\)/)).toBeInTheDocument()
    expect(
      within(dialog).getByRole('list', { name: 'Solicitudes del lote' }).children,
    ).toHaveLength(2)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), ' ok ')
    // Nada se manda hasta confirmar.
    expect(state.bodies).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar 2 capacidades' }))

    await waitFor(() =>
      expect(state.bodies).toEqual([{ decision: 'approve', ids: [12, 14], reason: 'ok' }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('2 de 2 aprobadas')).toBeInTheDocument()
    // Las decididas salieron de la lista y la selección se vació.
    await waitFor(() =>
      expect(screen.queryAllByRole('checkbox', { name: /^Seleccionar: / })).toHaveLength(0),
    )
    expect(screen.queryByRole('region', { name: /Acciones sobre las solicitudes/ })).toBeNull()
  })

  it('un resultado parcial lista cada fallo con su mensaje, se queda hasta cerrarlo y deja elegida la que falló', async () => {
    mockBulkBackend([DECIDABLE, SECOND, THIRD], () => ({
      decidedIds: [12],
      results: [
        decidedItem(DECIDABLE),
        {
          id: 14,
          ok: false,
          code: 'access.grant_not_pending',
          message: 'mensaje crudo del servidor',
        },
        { id: 15, ok: false, code: 'access.algo_nuevo', message: 'Explicación del servidor.' },
      ],
    }))
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await screen.findAllByText(DROP)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar todas (3)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 3' }))
    const dialog = await openDialog('¿Aprobar 3 capacidades?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar 3 capacidades' }))

    const summary = await screen.findByRole('alert')
    expect(within(summary).getByText('1 de 3 aprobadas')).toBeInTheDocument()
    expect(within(summary).getByText(/2 solicitudes no se pudieron decidir/)).toBeInTheDocument()
    // Asunto como lo muestra la fila + mensaje con el copy propio, o el del servidor si no hay.
    expect(within(summary).getByText(/de agarcia en Servidor · db-prod-02/)).toBeInTheDocument()
    expect(within(summary).getByText(/Esa solicitud ya no está pendiente/)).toBeInTheDocument()
    expect(within(summary).getByText(/de rdiaz en Servidor · db-prod-03/)).toBeInTheDocument()
    expect(within(summary).getByText(/Explicación del servidor\./)).toBeInTheDocument()
    expect(within(summary).queryByText(/mensaje crudo del servidor/)).toBeNull()

    // La decidida salió; las que fallaron siguen en la bandeja y elegidas.
    await waitFor(() =>
      expect(screen.queryAllByRole('checkbox', { name: /de mlopez en / })).toHaveLength(0),
    )
    const bar = screen.getByRole('region', { name: /Acciones sobre las solicitudes/ })
    expect(within(bar).getByText('2 seleccionadas')).toBeInTheDocument()

    // El resumen sigue ahí tras el refresco, hasta que se cierra.
    expect(screen.getByText('1 de 3 aprobadas')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar resumen' }))
    expect(screen.queryByText('1 de 3 aprobadas')).toBeNull()
  })

  it('rechazar el lote manda decision reject y el motivo', async () => {
    const state = mockBulkBackend([DECIDABLE, SECOND], (body) => ({
      decidedIds: body.ids,
      results: [decidedItem(DECIDABLE), decidedItem(SECOND)],
    }))
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await screen.findAllByText(DROP)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar todas (2)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar 2' }))
    const dialog = await openDialog('¿Rechazar 2 solicitudes?')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), 'no corresponde')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar 2 solicitudes' }))

    await waitFor(() =>
      expect(state.bodies).toEqual([
        { decision: 'reject', ids: [12, 14], reason: 'no corresponde' },
      ]),
    )
    expect(await screen.findByText('2 de 2 rechazadas')).toBeInTheDocument()
  })

  it('un error de la llamada entera (403) queda en el diálogo, sin resumen ni selección perdida', async () => {
    mockBulkBackend([DECIDABLE], () => ({ results: [], decidedIds: [] }))
    server.use(
      http.post(`${API}/capability-grants/decisions`, () =>
        HttpResponse.json(errorBody('access.forbidden', 'No tienes permiso.'), { status: 403 }),
      ),
    )
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await userEvent.click(await rowCheckbox('mlopez'))
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 1' }))
    const dialog = await openDialog('¿Aprobar 1 capacidad?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar 1 capacidad' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Tu acceso actual no la incluye/,
    )
    expect(screen.queryByText(/de 1 aprobadas/)).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // La selección sigue: se puede reintentar.
    expect(screen.getByRole('button', { name: 'Aprobar 1' })).toBeInTheDocument()
  })

  it('ante el 403 de step-up pide la contraseña UNA vez y reenvía el lote entero', async () => {
    let calls = 0
    const state = mockBulkBackend([DECIDABLE, SECOND], (body) => ({
      decidedIds: body.ids,
      results: [decidedItem(DECIDABLE), decidedItem(SECOND)],
    }))
    server.use(
      http.post(`${API}/capability-grants/decisions`, async ({ request }) => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json(
            {
              detail: {
                msg: 'Confirmá tu contraseña.',
                type: 'AppHttpException',
                public_context: { code: 'access.step_up_required', step_up_ttl_seconds: 300 },
              },
            },
            { status: 403 },
          )
        }
        const body = (await request.json()) as BulkBody
        state.bodies.push(body)
        return HttpResponse.json({
          data: {
            requested: 2,
            succeeded: 2,
            failed: 0,
            results: [decidedItem(DECIDABLE), decidedItem(SECOND)],
          },
        })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    renderWithProviders(<PendingCapabilityGrantsCard />)

    await screen.findAllByText(DROP)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar todas (2)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 2' }))
    const dialog = await openDialog('¿Aprobar 2 capacidades?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar 2 capacidades' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
    expect(state.bodies).toEqual([{ decision: 'approve', ids: [12, 14] }])
    expect(await screen.findByText('2 de 2 aprobadas')).toBeInTheDocument()
  })
})
