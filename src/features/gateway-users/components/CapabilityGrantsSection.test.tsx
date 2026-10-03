import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { CapabilityGrantsSection } from './CapabilityGrantsSection'

const API = 'http://localhost/api/v1'

const WRITE = 'Crear y editar bases gestionadas'
const DROP = 'Borrar bases de datos'
const GLOBAL_ONLY = 'Registrar, editar y dar de baja servidores'

const ACTIVE = {
  id: 11,
  user_id: 7,
  username: 'mlopez',
  capability: 'databases.write',
  scope_type: 'environment',
  scope_id: 1,
  scope_name: 'Desarrollo',
  status: 'active',
  sensitive: false,
  requested_by: { id: 2, username: 'otra-admin' },
  requested_at: '2026-10-01T18:00:00Z',
  expires_at: null,
  request_reason: 'release del viernes',
  implies: ['databases.read'],
}

const PENDING = {
  ...ACTIVE,
  id: 12,
  capability: 'databases.drop',
  scope_type: 'server',
  scope_id: 9,
  scope_name: 'db-prod-01',
  status: 'pending',
  sensitive: true,
  expires_at: '2026-10-08T18:00:00Z',
  request_reason: null,
  implies: ['databases.read'],
}

const REVOKED = {
  ...ACTIVE,
  id: 13,
  capability: 'exports.download',
  status: 'revoked',
  sensitive: true,
  decided_by: { id: 2, username: 'otra-admin' },
  decided_at: '2026-10-02T10:00:00Z',
  implies: [],
}

type Grant = Record<string, unknown> & { id: number }

/** Los cuatro GET que la sección pide, con la lista de capacidades como estado mutable. */
function mockBackend(initial: Grant[] = [ACTIVE, PENDING, REVOKED]) {
  const state = { grants: initial, listRequests: 0 }
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({
        data: meFixture({ role: 'operator', global_capabilities: ['access_admin'] }),
      }),
    ),
    http.get(`${API}/gateway-users/7/capability-grants`, () => {
      state.listRequests += 1
      return HttpResponse.json({ data: state.grants })
    }),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
    http.get(`${API}/servers`, () =>
      HttpResponse.json(pageOf([serverFixture(9, 'db-prod-01'), serverFixture(10, 'db-prod-02')])),
    ),
  )
  return state
}

function renderSection(
  props: { isSelf?: boolean; isActive?: boolean; catalog?: typeof GRANTS_CATALOG_FIXTURE } = {},
) {
  return renderWithProviders(
    <CapabilityGrantsSection
      user={{ id: 7, username: 'mlopez', is_active: props.isActive ?? true }}
      isSelf={props.isSelf ?? false}
      catalog={props.catalog ?? GRANTS_CATALOG_FIXTURE}
      isCatalogLoading={false}
    />,
  )
}

/** Abre el combobox `name` y elige la opción cuyo texto cumple `option`. */
async function pick(name: string, option: string | RegExp) {
  const input = screen.getByRole('combobox', { name })
  const box = input.parentElement
  if (!box) throw new Error(`falta el combobox ${name}`)
  await userEvent.click(within(box).getByRole('button', { name: 'Abrir lista' }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

function form() {
  return screen.getByRole('form', { name: 'Otorgar una capacidad' })
}

describe('CapabilityGrantsSection', () => {
  it('lista lo vigente con su etiqueta, id, alcance, estado y lectura implícita; el historial va aparte', async () => {
    mockBackend()
    renderSection()

    // Cada fila existe dos veces en el DOM (tabla y tarjeta): `DataTable` oculta una por CSS.
    expect((await screen.findAllByText(WRITE)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('databases.write').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Entorno · Desarrollo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Activa').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Incluye la lectura: Ver bases y su estructura.').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Motivo: release del viernes').length).toBeGreaterThan(0)
    // La pendiente avisa que todavía no concede nada.
    expect(screen.getAllByText('Pendiente de aprobación').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Todavía no concede acceso/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sensible').length).toBeGreaterThan(0)
    // El historial no se ve por defecto.
    expect(screen.queryByText('Descargar los datos exportados en claro')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Ver también el historial' }))
    expect(screen.getAllByText('Descargar los datos exportados en claro').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Revocada').length).toBeGreaterThan(0)
  })

  it('el selector ofrece solo lo otorgable, agrupado por módulo, y marca las sensibles', async () => {
    mockBackend()
    renderSection()
    await screen.findAllByText(WRITE)

    const input = screen.getByRole('combobox', { name: 'Capacidad' })
    await userEvent.click(
      within(input.parentElement as HTMLElement).getByRole('button', { name: 'Abrir lista' }),
    )
    const options = await screen.findAllByRole('option')
    const names = options.map((option) => option.textContent ?? '')
    expect(names.some((name) => name.includes(WRITE))).toBe(true)
    // Una global (eje `global`) no se otorga de forma puntual.
    expect(names.some((name) => name.includes(GLOBAL_ONLY))).toBe(false)
    expect(options).toHaveLength(GRANTS_CATALOG_FIXTURE.filter((row) => row.grantable).length)
    // Las sensibles (espejo de `is_sensitive`: otorgable y exclusiva de owner) lo dicen en la
    // opción; las otras no. `blueprints.apply` es sensible desde C3.
    const drop = options.find((option) => option.textContent?.includes(DROP))
    expect(drop).toHaveTextContent('Requiere segundo aprobador')
    const write = options.find((option) => option.textContent?.includes(WRITE))
    expect(write).not.toHaveTextContent('Requiere segundo aprobador')
    // Agrupadas: las capacidades de un mismo módulo van seguidas.
    const modules = options.map((option) =>
      option.textContent?.split('·')[1]?.replace('Requiere segundo aprobador', '').trim(),
    )
    const firstSeen = [...new Set(modules)]
    expect(modules).toEqual(firstSeen.flatMap((module) => modules.filter((m) => m === module)))
  })

  it('otorgar una no sensible manda el cuerpo y dice que ya rige', async () => {
    mockBackend()
    let body: unknown = null
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            data: {
              count: 1,
              pending: false,
              grants: [
                {
                  ...ACTIVE,
                  id: 20,
                  capability: 'databases.write',
                  scope_id: 3,
                  scope_name: 'Producción',
                },
              ],
            },
          },
          { status: 201 },
        )
      }),
    )
    renderSection()
    await screen.findAllByText(WRITE)

    await pick('Capacidad', new RegExp(WRITE))
    await pick('Entornos de destino', 'Producción')
    await userEvent.type(screen.getByRole('textbox', { name: 'Motivo' }), '  guardia  ')
    await userEvent.click(screen.getByRole('button', { name: 'Otorgar capacidad' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      capability: 'databases.write',
      scope_type: 'environment',
      scope_ids: [3],
      reason: 'guardia',
    })
    expect(await within(form()).findByText('Capacidad otorgada.')).toBeInTheDocument()
    expect(within(form()).getByText(/ya rige/)).toBeInTheDocument()
    // El formulario queda listo para otra: nada elegido y el envío deshabilitado.
    expect(screen.getByRole('combobox', { name: 'Capacidad' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Otorgar capacidad' })).toBeDisabled()
  })

  it('una sensible avisa ANTES de enviar y, al volver pending, que no concede acceso', async () => {
    mockBackend()
    let body: unknown = null
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            data: {
              count: 1,
              pending: true,
              grants: [{ ...PENDING, id: 21, scope_id: 10, scope_name: 'db-prod-02' }],
            },
          },
          { status: 201 },
        )
      }),
    )
    renderSection()
    await screen.findAllByText(WRITE)

    await pick('Capacidad', new RegExp(DROP))
    expect(
      within(form()).getByText(/Queda pendiente y no concede acceso hasta que otra persona/),
    ).toBeVisible()

    await pick('Tipo de destino', 'Servidor')
    // Otro servidor: en db-prod-01 ya hay una pendiente igual y el envío se bloquea por duplicado.
    await pick('Servidores de destino', 'db-prod-02')
    await userEvent.click(screen.getByRole('button', { name: 'Otorgar capacidad' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ capability: 'databases.drop', scope_type: 'server', scope_ids: [10] })
    expect(
      await within(form()).findByText('Solicitud enviada, todavía no conceden acceso.'),
    ).toBeInTheDocument()
    expect(within(form()).getByText(/queda pendiente hasta que otra persona/)).toBeInTheDocument()
  })

  it('con la propia cuenta no se puede otorgar ni revocar, y el motivo está a la vista', async () => {
    mockBackend()
    renderSection({ isSelf: true })
    const note = await screen.findByText(/No podés otorgarte ni quitarte capacidades a vos mismo/)
    expect(note).toBeVisible()

    const submit = screen.getByRole('button', { name: 'Otorgar capacidad' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-describedby', note.id)
    expect(screen.getByRole('combobox', { name: 'Capacidad' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Motivo' })).toBeDisabled()
    // La lista sigue ahí (es lectura), pero sin acciones.
    const revokes = await screen.findAllByRole('button', { name: /^Revocar: / })
    for (const button of revokes) expect(button).toBeDisabled()
  })

  it('una cuenta desactivada no recibe capacidades: formulario deshabilitado con el motivo', async () => {
    mockBackend()
    renderSection({ isActive: false })
    expect(await screen.findByText(/Esta cuenta está desactivada/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Otorgar capacidad' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Capacidad' })).toBeDisabled()
    // Revocar sí se puede: sacarle lo retenido a una cuenta inactiva no la beneficia.
    const revokes = await screen.findAllByRole('button', { name: /^Revocar: / })
    expect(revokes[0]).toBeEnabled()
  })

  it('no ofrece los destinos donde ya tiene una viva igual y lo avisa', async () => {
    mockBackend()
    renderSection()
    await screen.findAllByText(WRITE)

    await pick('Capacidad', new RegExp(WRITE))
    // ACTIVE ya es databases.write en Desarrollo: solo queda Producción para elegir.
    const input = screen.getByRole('combobox', { name: 'Entornos de destino' })
    await userEvent.click(
      within(input.parentElement as HTMLElement).getByRole('button', { name: 'Abrir lista' }),
    )
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Producción'])
    expect(within(form()).getByText(/1 destino ya tiene esa capacidad/)).toBeInTheDocument()
  })

  it('«Seleccionar todos» elige todos los ofrecibles y manda un solo lote', async () => {
    mockBackend()
    let body: unknown = null
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            data: {
              count: 2,
              pending: false,
              grants: [
                {
                  ...ACTIVE,
                  id: 30,
                  capability: 'databases.write',
                  scope_id: 9,
                  scope_type: 'server',
                  scope_name: 'db-prod-01',
                },
                {
                  ...ACTIVE,
                  id: 31,
                  capability: 'databases.write',
                  scope_id: 10,
                  scope_type: 'server',
                  scope_name: 'db-prod-02',
                },
              ],
            },
          },
          { status: 201 },
        )
      }),
    )
    renderSection()
    await screen.findAllByText(WRITE)

    await pick('Capacidad', new RegExp(WRITE))
    await pick('Tipo de destino', 'Servidor')
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar todos (2)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Otorgar capacidad' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      capability: 'databases.write',
      scope_type: 'server',
      scope_ids: [9, 10],
    })
    expect(await within(form()).findByText('Capacidad otorgada en 2 destinos.')).toBeInTheDocument()
    expect(within(form()).getByText(/db-prod-01, db-prod-02 ya rige/)).toBeInTheDocument()
  })

  it('un lote rechazado lista cada destino que falló y conserva lo elegido', async () => {
    mockBackend()
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No se otorgó nada: hay destinos que no se pueden otorgar.',
              type: 'AppHttpException',
              public_context: {
                code: 'access.grant_bulk_failed',
                failures: [
                  {
                    scope_id: 3,
                    code: 'access.grant_scope_not_found',
                    message: 'El entorno o servidor indicado no existe.',
                  },
                ],
              },
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderSection()
    await screen.findAllByText(WRITE)

    await pick('Capacidad', new RegExp(WRITE))
    await pick('Entornos de destino', 'Producción')
    await userEvent.click(screen.getByRole('button', { name: 'Otorgar capacidad' }))

    // En el formulario, no solo en el toast, que se cierra solo.
    const alert = await within(form()).findByRole('alert')
    expect(alert).toHaveTextContent('No se otorgó nada')
    // Cada destino que falló, con su motivo.
    // «Producción» aparece dos veces: la ficha del destino elegido y el renglón del error.
    expect(within(form()).getAllByText('Producción')).toHaveLength(2)
    expect(
      within(form()).getByText(/El entorno o servidor elegido ya no existe/),
    ).toBeInTheDocument()
    // Lo elegido se conserva para corregir y reintentar.
    expect(screen.getByRole('combobox', { name: 'Capacidad' })).toHaveValue(WRITE)

    // Tocar un campo descarta el error: ya no habla de lo que hay en pantalla.
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    expect(within(form()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un 403 usa el copy compartido de acceso en el formulario', async () => {
    mockBackend()
    server.use(
      http.post(`${API}/gateway-users/7/capability-grants/bulk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No tienes permiso para esta operación.',
              type: 'AppHttpException',
              public_context: { code: 'access.forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    renderSection()
    await screen.findAllByText(WRITE)
    await pick('Capacidad', new RegExp(WRITE))
    await pick('Entornos de destino', 'Producción')
    await userEvent.click(screen.getByRole('button', { name: 'Otorgar capacidad' }))

    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      /Tu acceso actual no la incluye/,
    )
  })

  it('revocar una activa pide confirmación y manda el DELETE', async () => {
    const state = mockBackend()
    let deleted: string | null = null
    server.use(
      http.delete(`${API}/gateway-users/7/capability-grants/:gid`, ({ params }) => {
        deleted = String(params.gid)
        state.grants = state.grants.filter((grant) => String(grant.id) !== deleted)
        return HttpResponse.json({ data: { ...ACTIVE, status: 'revoked' } })
      }),
    )
    renderSection()
    const buttons = await screen.findAllByRole('button', {
      name: `Revocar: ${WRITE} en Entorno · Desarrollo`,
    })
    await userEvent.click(buttons[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('¿Revocar esta capacidad?')).toBeInTheDocument()
    // Nada se manda hasta confirmar.
    expect(deleted).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revocar capacidad' }))

    await waitFor(() => expect(deleted).toBe('11'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // La lista se refresca sola con el resultado.
    await waitFor(() => expect(screen.queryAllByText(WRITE)).toHaveLength(0))
  })

  it('cancelar una pendiente usa otra redacción y el mismo endpoint', async () => {
    mockBackend()
    let deleted: string | null = null
    server.use(
      http.delete(`${API}/gateway-users/7/capability-grants/:gid`, ({ params }) => {
        deleted = String(params.gid)
        return HttpResponse.json({ data: { ...PENDING, status: 'cancelled' } })
      }),
    )
    renderSection()
    const buttons = await screen.findAllByRole('button', {
      name: `Cancelar solicitud: ${DROP} en Servidor · db-prod-01`,
    })
    await userEvent.click(buttons[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('¿Cancelar esta solicitud?')).toBeInTheDocument()
    expect(within(dialog).getByText(/no llega a concederse/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar solicitud' }))
    await waitFor(() => expect(deleted).toBe('12'))
  })

  it('cerrar el diálogo sin confirmar no revoca nada', async () => {
    mockBackend()
    let called = false
    server.use(
      http.delete(`${API}/gateway-users/7/capability-grants/:gid`, () => {
        called = true
        return HttpResponse.json({ data: ACTIVE })
      }),
    )
    renderSection()
    const buttons = await screen.findAllByRole('button', { name: /^Revocar: / })
    await userEvent.click(buttons[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(called).toBe(false)
  })

  it('un 403 al listar muestra el estado de acceso compartido, sin reintentar', async () => {
    mockBackend()
    server.use(
      http.get(`${API}/gateway-users/7/capability-grants`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No tienes permiso para esta operación.',
              type: 'AppHttpException',
              public_context: { code: 'access.forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    renderSection()
    expect(
      await screen.findByText('No tenés acceso a las capacidades puntuales'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })

  it('sin capacidades vigentes lo dice y sin catálogo otorgable no ofrece nada', async () => {
    mockBackend([REVOKED])
    renderSection({ catalog: [] })
    expect(
      (await screen.findAllByText('mlopez no tiene capacidades puntuales vigentes.')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/el catálogo no publicó ninguna/)).toBeInTheDocument()
  })
})
