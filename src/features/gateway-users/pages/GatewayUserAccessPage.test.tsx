import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { createTestQueryClient } from '@/test/utils'
import {
  CATALOG_FIXTURE,
  environmentFixture,
  meFixture,
  pageOf,
  serverFixture,
} from '@/test/fixtures/authz-catalog'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { ToastProvider } from '@/lib/toast/ToastProvider'
import type { GatewayUserOut } from '@/lib/contracts'
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

function mockBackend(me: Record<string, unknown> = ACTOR) {
  let detailRequests = 0
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/gateway-users/7`, () => {
      detailRequests += 1
      return HttpResponse.json({ data: target })
    }),
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
  return { detailRequests: () => detailRequests }
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
      'Acceso efectivo al guardar',
    ])
    // El marcador de lo que viene es solo texto: ningún control que prometa algo.
    expect(
      screen.getByText('Próximamente: asignar una capacidad puntual sin cambiar el rol.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar accesos' })).toBeInTheDocument()
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

  it('muestra el acceso efectivo al guardar, enlazado desde cada permiso', async () => {
    mockBackend()
    renderAt()
    expect((await screen.findAllByText('Producción · owner')).length).toBeGreaterThan(0)
    // La diferencia se dice UNA vez, en el panel; la fila del permiso enlaza ahí.
    expect(screen.getAllByText(/Suma 14:/)).toHaveLength(1)
    const link = screen.getByRole('link', { name: 'Ver el efecto al guardar' })
    const anchor = (link.getAttribute('href') ?? '').slice(1)
    expect(document.getElementById(anchor)).toHaveTextContent('Producción · owner')
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
