import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { createTestQueryClient } from '@/test/utils'
import {
  GRANTS_CATALOG_FIXTURE,
  environmentFixture,
  fixtureRoleCapabilities,
  meFixture,
  pageOf,
  serverFixture,
} from '@/test/fixtures/authz-catalog'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { ToastProvider } from '@/lib/toast/ToastProvider'
import type { GatewayUserOut } from '@/lib/contracts'
import { SERVER_RESOLUTION_INVENTORY_NOTE } from '@/features/auth'
import { SECOND_APPROVER_LABEL } from '../assignment-policy'
import { SELF_ACCESS_NOTE } from '../self-access'
import { GatewayUserAccessPage } from './GatewayUserAccessPage'

const API = 'http://localhost/api/v1'

const target: GatewayUserOut = {
  id: 7,
  username: 'mlopez',
  email: 'mlopez@empresa.com',
  full_name: 'María López',
  gateway_role: 'viewer',
  is_active: true,
  credential_set: true,
  global_capabilities: [],
  // Un owner que ya tiene en Producción: conservarlo NO es una elevación (el backend solo mide lo
  // que se agrega), moverlo a otro destino sí.
  scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

/**
 * Quien edita: operator con access_admin. No tiene security_officer ni llega a owner, y desde C3
 * igual puede asignar las dos cosas: lo que eleva queda pendiente de otra persona.
 */
const ACTOR = meFixture({ role: 'operator', global_capabilities: ['access_admin'] })

/**
 * `GET /gateway-users/7/effective-access` coherente con `target`: viewer de base, owner en
 * Producción y una capacidad puntual (`databases.write`) sobre db-prod-01 con su lectura implícita.
 */
const EFFECTIVE_FIXTURE = {
  user_id: 7,
  username: 'mlopez',
  active: true,
  base_role: 'viewer',
  scope_roles: [
    { scope_type: 'environment', scope_id: 3, scope_name: 'Producción', role: 'owner' },
  ],
  global_capabilities: [],
  capabilities: [
    ...fixtureRoleCapabilities('viewer').map((capability) => ({ capability, source: 'role' })),
    ...fixtureRoleCapabilities('owner').map((capability) => ({
      capability,
      source: 'scoped_role',
      scope_type: 'environment',
      scope_id: 3,
      scope_name: 'Producción',
    })),
    {
      capability: 'databases.write',
      source: 'capability_grant',
      scope_type: 'server',
      scope_id: 9,
      scope_name: 'db-prod-01',
      grant_id: 11,
    },
    {
      capability: 'databases.read',
      source: 'capability_grant',
      scope_type: 'server',
      scope_id: 9,
      scope_name: 'db-prod-01',
      grant_id: 11,
      implied_by: 'databases.write',
    },
  ],
  catalog_version: 'test-v1',
}

function mockBackend(me: Record<string, unknown> = ACTOR, readiness: Record<string, unknown> = {}) {
  let detailRequests = 0
  let effectiveRequests = 0
  let grantsRequests = 0
  server.use(
    http.get(`${API}/gateway-users/7/capability-grants`, () => {
      grantsRequests += 1
      return HttpResponse.json({ data: [] })
    }),
    http.get(`${API}/gateway-users/7/effective-access`, () => {
      effectiveRequests += 1
      return HttpResponse.json({ data: EFFECTIVE_FIXTURE })
    }),
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })),
    http.get(`${API}/gateway-users/7`, () => {
      detailRequests += 1
      return HttpResponse.json({ data: target })
    }),
    http.get(`${API}/authz/scope-readiness`, () =>
      HttpResponse.json({
        data: {
          total_databases: 0,
          unclassified_databases: 0,
          ready: true,
          servers: [],
          ...readiness,
        },
      }),
    ),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(9, 'db-prod-01')]))),
  )
  return {
    detailRequests: () => detailRequests,
    effectiveRequests: () => effectiveRequests,
    grantsRequests: () => grantsRequests,
  }
}

/**
 * La página usa `useBlocker`, que solo existe dentro de un data router: `renderWithProviders`
 * monta un `MemoryRouter` clásico, así que acá se arma un `createMemoryRouter` con el listado
 * como destino de «volver».
 */
function renderAt(path = '/gateway-users/7/accesos') {
  const router = createMemoryRouter(
    [
      { path: '/gateway-users/:userId/accesos', element: <GatewayUserAccessPage /> },
      { path: '/gateway-users', element: <p>Listado de usuarios</p> },
      { path: '/mi-cuenta', element: <p>Mi cuenta</p> },
    ],
    { initialEntries: [path] },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

/** El botón «Abrir lista» del combobox `name` de la fila `index`. */
function comboToggle(name: string, index: number) {
  const input = screen.getAllByRole('combobox', { name })[index]
  const box = input?.parentElement
  if (!box) throw new Error(`falta el combobox ${name} ${index}`)
  return within(box).getByRole('button', { name: 'Abrir lista' })
}

function roleToggle(index: number) {
  return comboToggle('Rol en ese alcance', index)
}

describe('GatewayUserAccessPage', () => {
  it('pinta la cabecera con el usuario, su rol base y las secciones en orden', async () => {
    mockBackend()
    renderAt()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Accesos de mlopez' }),
    ).toBeInTheDocument()
    expect(screen.getByText('María López')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Usuarios del gateway' })).toHaveAttribute(
      'href',
      '/gateway-users',
    )
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(sections).toEqual([
      'Capacidades globales',
      'Permisos por entorno o servidor',
      'Capacidades puntuales',
      'Acceso efectivo',
    ])
    // La sección ya es real (R11): el marcador «Próximamente» desapareció y hay un formulario.
    expect(screen.queryByText(/Próximamente/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Otorgar capacidad' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar accesos' })).toBeInTheDocument()
  })

  it('F-17: avisa que el entorno de un servidor sale solo de lo inventariado', async () => {
    mockBackend(ACTOR, { server_resolution_inventory_only: true })
    renderAt()
    expect(
      await screen.findByText(SERVER_RESOLUTION_INVENTORY_NOTE, { exact: false }),
    ).toBeVisible()
  })

  it('sin el flag (backend anterior) no muestra ese aviso', async () => {
    mockBackend()
    renderAt()
    await screen.findByRole('heading', { level: 1, name: 'Accesos de mlopez' })
    expect(screen.queryByText(SERVER_RESOLUTION_INVENTORY_NOTE, { exact: false })).toBeNull()
  })

  it('sin techo (C3): las globales que el actor no tiene se ofrecen y se marcan como elevación', async () => {
    mockBackend()
    renderAt()
    const officer = await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    expect(officer).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Administración de accesos' })).toBeEnabled()
    expect(screen.getByText('security_officer')).toBeInTheDocument()
    // Las dos globales son nuevas para esta persona: agregar cualquiera eleva.
    expect(screen.getAllByText(SECOND_APPROVER_LABEL)).toHaveLength(2)
    expect(screen.queryByText(/Solo podés otorgar hasta/)).not.toBeInTheDocument()
  })

  it('ofrece todos los roles; owner se marca solo donde sería nuevo', async () => {
    mockBackend()
    renderAt()
    await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })

    // En Producción ya es owner: conservarlo no eleva.
    await userEvent.click(roleToggle(0))
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Añadir permiso' }))
    await userEvent.click(roleToggle(1))
    expect(screen.getByRole('option', { name: 'operator' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: new RegExp(`^owner\\s*${SECOND_APPROVER_LABEL}$`) }),
    ).toBeInTheDocument()
  })

  it('muestra lo que rige hoy según el servidor, con su fuente, enlazado desde cada permiso', async () => {
    mockBackend()
    renderAt()
    expect((await screen.findAllByText('Producción · owner')).length).toBeGreaterThan(0)
    // Sin cambios: solo el servidor, rotulado por fuente; ninguna vista previa.
    expect(screen.getByText('Rol por alcance')).toBeInTheDocument()
    expect(screen.getByText('Por rol')).toBeInTheDocument()
    expect(screen.getByText('Capacidad puntual')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Ver capacidades de Crear y editar bases gestionadas · db-prod-01',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Vista previa: así quedaría al guardar')).not.toBeInTheDocument()
    // El enlace del permiso apunta a su fila del servidor.
    const link = screen.getByRole('link', { name: 'Ver el efecto al guardar' })
    const anchor = (link.getAttribute('href') ?? '').slice(1)
    expect(document.getElementById(anchor)).toHaveTextContent('Producción · owner')
  })

  it('con cambios sin guardar agrega la vista previa rotulada, sin reemplazar lo del servidor', async () => {
    mockBackend()
    renderAt()
    await screen.findByText('Rol por alcance')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Administración de accesos' }))
    expect(
      await screen.findByRole('heading', { name: 'Vista previa: así quedaría al guardar' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rige hoy' })).toBeInTheDocument()
    // Lo del servidor sigue ahí, y la vista previa suma la global que se está marcando y arrastra
    // la capacidad puntual del servidor.
    expect(screen.getByText('Rol por alcance')).toBeInTheDocument()
    expect(screen.getByText('Capacidad global')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', {
        name: 'Ver capacidades de Crear y editar bases gestionadas · db-prod-01',
      }),
    ).toHaveLength(2)
    // El enlace apunta a UNA fila (la de la vista previa), no hay ids repetidos.
    const link = screen.getByRole('link', { name: 'Ver el efecto al guardar' })
    const anchor = (link.getAttribute('href') ?? '').slice(1)
    expect(document.querySelectorAll(`[id="${anchor}"]`)).toHaveLength(1)
    expect(document.getElementById(anchor)).toHaveTextContent('Producción · owner')
  })

  it('para access_admin la sección pide las capacidades de ESA persona y no depende de «Guardar accesos»', async () => {
    const { grantsRequests } = mockBackend()
    renderAt()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Capacidades puntuales' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(grantsRequests()).toBe(1))
    expect(
      screen.getByText(/Se aplican al instante, sin pasar por «Guardar accesos»/),
    ).toBeVisible()
    // Otorgar no es un cambio del formulario: no activa la vista previa ni el aviso de salida.
    expect(screen.queryByText('Vista previa: así quedaría al guardar')).not.toBeInTheDocument()
  })

  it('security_officer no tiene `access.admin`: no abre la página ni pide el usuario, sus puntuales ni su acceso efectivo', async () => {
    const officer = meFixture({ role: 'operator', global_capabilities: ['security_officer'] })
    const backend = mockBackend(officer)
    renderAt()
    expect(
      await screen.findByText('No tenés acceso a los accesos de los usuarios del gateway'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Capacidades puntuales' }),
    ).not.toBeInTheDocument()
    expect(backend.detailRequests()).toBe(0)
    expect(backend.grantsRequests()).toBe(0)
    expect(backend.effectiveRequests()).toBe(0)
  })

  it('mover un owner a otro destino lo marca como elevación, guarda el estado COMPLETO y vuelve al listado', async () => {
    mockBackend()
    let body: unknown = null
    server.use(
      http.put(`${API}/gateway-users/7/access`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: target })
      }),
    )
    const router = renderAt()
    await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    expect(
      screen.queryByText('Parte de este cambio requiere un segundo aprobador'),
    ).not.toBeInTheDocument()

    // El `owner` sobre Producción no elevaba por ser el que ya tenía AHÍ. En Desarrollo es un
    // owner nuevo: ya no se recorta (no hay techo), se avisa que queda pendiente.
    await userEvent.click(comboToggle('Entorno', 0))
    await userEvent.click(screen.getByRole('option', { name: 'Desarrollo' }))
    expect(screen.getByRole('combobox', { name: 'Rol en ese alcance' })).toHaveValue('owner')
    expect(screen.getByText(/Es un owner nuevo en este destino/)).toBeInTheDocument()
    const note = screen.getByText('Parte de este cambio requiere un segundo aprobador')
    expect(note.closest('[id]')).toHaveTextContent('owner en Desarrollo')
    expect(screen.getByRole('button', { name: 'Guardar accesos' })).toHaveAttribute(
      'aria-describedby',
      expect.stringMatching(/-pendiente$/),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Guardar accesos' }))
    await expect.poll(() => body).not.toBeNull()
    // Reemplazo total: los dos campos, siempre, y sin campos internos del formulario.
    expect(body).toEqual({
      global_capabilities: [],
      scope_grants: [{ scope_type: 'environment', scope_id: 1, role: 'owner' }],
    })
    // Guardado: sale sin preguntar por cambios sin guardar.
    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/gateway-users')
    expect(screen.queryByText('¿Salir sin guardar?')).not.toBeInTheDocument()
  })

  it('un 202 (elevación pendiente) lleva a la solicitud en la bandeja, sin preguntar por cambios', async () => {
    mockBackend()
    server.use(
      http.put(`${API}/gateway-users/7/access`, () =>
        HttpResponse.json(
          {
            data: {
              ...target,
              code: 'access.elevation_pending',
              pending_request: {
                id: 12,
                status: 'pending',
                origin: 'set_access',
                target: { id: 7, username: 'mlopez' },
                requested_by: { id: 1, username: 'admin' },
                desired: {
                  gateway_role: 'viewer',
                  global_capabilities: ['access_admin'],
                  scope_grants: target.scope_grants,
                },
                elevations: [{ kind: 'global_capability', global_capability: 'access_admin' }],
                sod_override: null,
                created_at: '2026-10-02T10:00:00Z',
                expires_at: '2026-10-09T10:00:00Z',
              },
            },
            message: 'La elevación quedó pendiente.',
          },
          { status: 202 },
        ),
      ),
    )
    const router = renderAt()
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Administración de accesos' }),
    )
    expect(
      screen.getByText('Parte de este cambio requiere un segundo aprobador'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar accesos' }))

    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/gateway-users')
    expect(router.state.location.search).toBe('?tab=pending&solicitud=12')
    expect(screen.queryByText('¿Salir sin guardar?')).not.toBeInTheDocument()
    // El aviso dice qué pasó y enlaza a la solicitud.
    expect(
      await screen.findByText(
        'Se aplicó lo que no requiere aprobación; la elevación quedó pendiente de otro administrador de accesos.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver la solicitud' })).toHaveAttribute(
      'href',
      '/gateway-users?tab=pending&solicitud=12',
    )
  })

  it('con cambios sin guardar, salir pide confirmación', async () => {
    mockBackend()
    const router = renderAt()
    await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Administración de accesos' }))

    await userEvent.click(screen.getByRole('link', { name: 'Cancelar' }))
    expect(await screen.findByText('¿Salir sin guardar?')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/gateway-users/7/accesos')

    await userEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }))
    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
  })

  it('sin cambios, «Cancelar» vuelve al listado sin preguntar', async () => {
    mockBackend()
    renderAt()
    await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    await userEvent.click(screen.getByRole('link', { name: 'Cancelar' }))
    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
  })

  it('la propia cuenta se ve en solo lectura, con el motivo y sin «Guardar accesos»', async () => {
    mockBackend({ ...ACTOR, id: 7, username: 'mlopez' })
    renderAt()
    expect(await screen.findByText('Es tu propia cuenta')).toBeInTheDocument()
    expect(screen.getByText(SELF_ACCESS_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar accesos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Añadir permiso' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Administración de accesos' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Volver al listado' })).toHaveAttribute(
      'href',
      '/gateway-users',
    )
  })

  it('sin `access.admin` muestra el estado de acceso compartido y no pide el usuario', async () => {
    const backend = mockBackend(meFixture({ role: 'owner' }))
    renderAt()
    expect(
      await screen.findByText('No tenés acceso a los accesos de los usuarios del gateway'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver mi acceso' })).toHaveAttribute(
      'href',
      '/mi-cuenta',
    )
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(backend.detailRequests()).toBe(0)
  })
})

describe('GatewayUserAccessPage — separación de funciones', () => {
  /** El admin sembrado: owner con las dos globales. */
  const SEEDED = meFixture({
    role: 'owner',
    global_capabilities: ['access_admin', 'security_officer'],
  })

  const SOD_409 = {
    detail: {
      msg: 'Esta combinación de acceso viola la separación de deberes.',
      type: 'AppHttpException',
      public_context: {
        code: 'access.sod_conflict',
        rules: ['owner_security_officer'],
        conflicts: [
          {
            rule: 'owner_security_officer',
            sources: [
              { kind: 'scope_grant', scope_type: 'environment', scope_id: 3, role: 'owner' },
            ],
          },
        ],
        override: { field: 'sod_override', reason_min_length: 20, max_hours: 168 },
      },
    },
  }

  function mockSod(onPut: (body: unknown) => Response) {
    const bodies: unknown[] = []
    server.use(
      http.get(`${API}/authz/sod-report`, () =>
        HttpResponse.json({ data: { exceptions: [], uncovered: [] } }),
      ),
      http.put(`${API}/gateway-users/7/access`, async ({ request }) => {
        const body = await request.json()
        bodies.push(body)
        return onPut(body)
      }),
    )
    return bodies
  }

  it('avisa ANTES de guardar si la combinación junta oficial de seguridad con owner', async () => {
    mockBackend(SEEDED)
    mockSod(() => HttpResponse.json({ data: target }))
    renderAt()
    const officer = await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    expect(
      screen.queryByText('Esta combinación viola la separación de funciones'),
    ).not.toBeInTheDocument()

    await userEvent.click(officer)
    expect(
      await screen.findByText('Esta combinación viola la separación de funciones'),
    ).toBeInTheDocument()
    // La fuente nombra el destino por su nombre, no por el id.
    expect(screen.getByText(/rol owner en el entorno Producción/)).toBeInTheDocument()
    // Además del aviso de separación, agregar la global eleva: los dos describen el botón.
    expect(screen.getByRole('button', { name: 'Guardar accesos' })).toHaveAttribute(
      'aria-describedby',
      expect.stringMatching(/-sod(\s|$)/),
    )

    // Destildarla saca el aviso: no queda nada que separar.
    await userEvent.click(officer)
    expect(
      screen.queryByText('Esta combinación viola la separación de funciones'),
    ).not.toBeInTheDocument()
  })

  it('con una excepción vigente de esa persona dice que el servidor acepta guardar', async () => {
    mockBackend(SEEDED)
    server.use(
      http.get(`${API}/authz/sod-report`, () =>
        HttpResponse.json({
          data: {
            exceptions: [
              {
                id: 1,
                user: { id: 7, username: 'mlopez' },
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
            ],
            uncovered: [],
          },
        }),
      ),
    )
    renderAt()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Oficial de seguridad' }))
    expect(
      await screen.findByText('Combinación cubierta por una excepción vigente'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Esta combinación viola la separación de funciones'),
    ).not.toBeInTheDocument()
  })

  it('ante el 409 fija el conflicto y reenvía el MISMO estado con `sod_override`', async () => {
    mockBackend(SEEDED)
    const bodies = mockSod((body) =>
      (body as { sod_override?: unknown }).sod_override
        ? HttpResponse.json({ data: target })
        : HttpResponse.json(SOD_409, { status: 409 }),
    )
    renderAt()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Oficial de seguridad' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar accesos' }))

    expect(
      await screen.findByText('El servidor rechazó el cambio: separación de funciones'),
    ).toBeInTheDocument()
    // El rechazo del servidor reemplaza al aviso previo: una sola voz.
    expect(
      screen.queryByText('Esta combinación viola la separación de funciones'),
    ).not.toBeInTheDocument()

    // La excepción es secundaria: cerrada hasta que se abre a propósito.
    const summary = screen.getByText('Excepción de emergencia')
    const disclosure = within(summary.closest('details') as HTMLElement)
    const resend = disclosure.getByRole('button', {
      name: 'Guardar accesos con excepción de emergencia',
    })
    expect(resend).not.toBeVisible()
    await userEvent.click(summary)
    expect(resend).toBeVisible()

    // Un motivo corto no sale: lo frena el formulario con el mínimo del servidor.
    await userEvent.type(disclosure.getByLabelText(/Motivo/), 'urgente')
    await userEvent.click(resend)
    expect(await screen.findByText('Mínimo 20 caracteres')).toBeInTheDocument()
    expect(bodies).toHaveLength(1)

    await userEvent.clear(disclosure.getByLabelText(/Motivo/))
    await userEvent.type(
      disclosure.getByLabelText(/Motivo/),
      'Incidente 4711: no hay otro security_officer',
    )
    const hours = disclosure.getByLabelText(/Duración/)
    await userEvent.clear(hours)
    await userEvent.type(hours, '24')
    await userEvent.click(resend)

    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1]).toEqual({
      global_capabilities: ['security_officer'],
      scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
      sod_override: {
        reason: 'Incidente 4711: no hay otro security_officer',
        expires_in_hours: 24,
      },
    })
    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
  })
})
