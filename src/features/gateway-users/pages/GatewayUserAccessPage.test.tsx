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
import { GLOBAL_CEILING_HINT } from '../grant-ceiling'
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
  // Un permiso que supera el techo de quien edita, otorgado antes por otra persona: se tiene que
  // poder conservar, porque el backend solo mide lo que se AGREGA.
  scope_grants: [{ scope_type: 'environment', scope_id: 3, role: 'owner' }],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

/** Quien edita: operator con access_admin. No tiene security_officer ni llega a owner. */
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

  it('deshabilita la global que el actor no tiene, con el motivo a la vista', async () => {
    mockBackend()
    renderAt()
    const officer = await screen.findByRole('checkbox', { name: 'Oficial de seguridad' })
    // El techo llega con `/auth/me`: hasta entonces no se sabe qué ocultar.
    await screen.findByText(/Solo podés otorgar hasta operator/)
    expect(officer).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Administración de accesos' })).toBeEnabled()
    expect(screen.getByText('security_officer')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(GLOBAL_CEILING_HINT))).toBeInTheDocument()
  })

  it('un permiso nuevo no ofrece roles por encima del techo; el existente conserva el suyo', async () => {
    mockBackend()
    renderAt()
    await screen.findByText(/Solo podés otorgar hasta operator/)

    await userEvent.click(roleToggle(0))
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Añadir permiso' }))
    await userEvent.click(roleToggle(1))
    expect(screen.getByRole('option', { name: 'operator' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'owner' })).not.toBeInTheDocument()
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

  it('«Capacidades puntuales» es solo de access_admin: otro rol no la ve ni dispara sus consultas', async () => {
    const officer = meFixture({ role: 'operator', global_capabilities: ['security_officer'] })
    const { grantsRequests } = mockBackend(officer)
    renderAt()
    await screen.findByRole('heading', { level: 2, name: 'Acceso efectivo al guardar' })
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Capacidades puntuales' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Otorgar capacidad' })).not.toBeInTheDocument()
    expect(grantsRequests()).toBe(0)
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

  it('el acceso efectivo del servidor solo se pide a quien es access_admin', async () => {
    const officer = meFixture({ role: 'operator', global_capabilities: ['security_officer'] })
    const { effectiveRequests } = mockBackend(officer)
    renderAt()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Acceso efectivo al guardar' }),
    ).toBeInTheDocument()
    expect((await screen.findAllByText('Producción · owner')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Las capacidades puntuales no se incluyen acá/)).toBeInTheDocument()
    expect(effectiveRequests()).toBe(0)
  })

  it('al cambiar el destino baja el rol al techo, guarda el estado COMPLETO y vuelve al listado', async () => {
    mockBackend()
    let body: unknown = null
    server.use(
      http.put(`${API}/gateway-users/7/access`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: target })
      }),
    )
    const router = renderAt()
    await screen.findByText(/Solo podés otorgar hasta operator/)

    // El `owner` sobre Producción se conservaba por ser el que ya tenía AHÍ. En Desarrollo es un
    // permiso nuevo y supera el techo: sin el recorte, el backend respondería 409.
    await userEvent.click(comboToggle('Entorno', 0))
    await userEvent.click(screen.getByRole('option', { name: 'Desarrollo' }))
    expect(screen.getByRole('combobox', { name: 'Rol en ese alcance' })).toHaveValue('operator')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar accesos' }))
    await expect.poll(() => body).not.toBeNull()
    // Reemplazo total: los dos campos, siempre, y sin campos internos del formulario.
    expect(body).toEqual({
      global_capabilities: [],
      scope_grants: [{ scope_type: 'environment', scope_id: 1, role: 'operator' }],
    })
    // Guardado: sale sin preguntar por cambios sin guardar.
    expect(await screen.findByText('Listado de usuarios')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/gateway-users')
    expect(screen.queryByText('¿Salir sin guardar?')).not.toBeInTheDocument()
  })

  it('con cambios sin guardar, salir pide confirmación', async () => {
    mockBackend()
    const router = renderAt()
    await screen.findByText(/Solo podés otorgar hasta operator/)
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
    await screen.findByText(/Solo podés otorgar hasta operator/)
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

  it('sin `gateway.admin` muestra el estado de acceso compartido y no pide el usuario', async () => {
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
