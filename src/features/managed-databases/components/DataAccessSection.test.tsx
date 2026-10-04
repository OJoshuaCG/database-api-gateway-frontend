import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, managedDatabaseFixture, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import { DataAccessSection } from './DataAccessSection'

const API = 'http://localhost/api/v1'
const BASE = `${API}/managed-databases/11`
const DAY_MS = 24 * 60 * 60 * 1000

function utcDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 19)
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    managed_database_id: 11,
    has_data_credential: true,
    verified_at: utcDaysAgo(1),
    probed_at: utcDaysAgo(1),
    probe_violations: [],
    probe_warnings: [],
    data_access_allowed: false,
    data_access_state: 'closed',
    data_access_second_approver_required: true,
    ...overrides,
  }
}

/** Sesión con las capacidades dadas: `servers.admin` (credencial) y/o `data.read` (opt-in). */
function mockSession({
  serversAdmin = true,
  dataRead = true,
  current = status(),
}: { serversAdmin?: boolean; dataRead?: boolean; current?: Record<string, unknown> } = {}) {
  const capabilities = ['databases.read']
  if (serversAdmin) capabilities.push('servers.admin')
  if (dataRead) capabilities.push('data.read')
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({ data: meFixture({ role: 'owner', capabilities }) }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${BASE}/data-credential`, () => HttpResponse.json({ data: current })),
  )
}

async function expand() {
  const user = userEvent.setup()
  renderWithProviders(<DataAccessSection database={managedDatabaseFixture()} />)
  await user.click(screen.getByRole('button', { name: /Configurar lectura de datos/ }))
  return user
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('DataAccessSection', () => {
  it('colapsada no consulta nada y explica que es lectura de filas', () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/data-credential`, () => {
        calls += 1
        return HttpResponse.json({ data: status() })
      }),
    )
    renderWithProviders(<DataAccessSection database={managedDatabaseFixture()} />)

    expect(screen.getByRole('button', { name: /Configurar lectura de datos/ })).toBeVisible()
    expect(screen.getByText(/lea FILAS de esta base/)).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('al abrirla avisa que expone filas y que el kill switch es del gateway', async () => {
    mockSession()
    await expand()

    expect(await screen.findByText('Esto expone FILAS reales de la base')).toBeInTheDocument()
    expect(screen.getByText(/MCP_DATA_READ_ENABLED/)).toBeInTheDocument()
    expect(screen.getByText('Credencial verificada')).toBeInTheDocument()
    expect(screen.getByText('Lectura de datos cerrada')).toBeInTheDocument()
  })

  it('sin credencial ofrece generarla 🔌 y no deja pedir el acceso', async () => {
    mockSession({ current: status({ has_data_credential: false, verified_at: null }) })
    await expand()

    expect(
      await screen.findByRole('button', { name: 'Generar credencial de datos 🔌' }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Pedir acceso a datos' })).toBeDisabled()
    expect(screen.getByText(/Primero generá la credencial de datos/)).toBeInTheDocument()
  })

  it('generar la credencial hace POST sin cuerpo y muestra «sin verificar»', async () => {
    mockSession({ current: status({ has_data_credential: false, verified_at: null }) })
    let body: string | null = null
    server.use(
      http.post(`${BASE}/data-credential/provision`, async ({ request }) => {
        body = await request.text()
        return HttpResponse.json({ data: status({ verified_at: null }) })
      }),
    )
    const user = await expand()

    await user.click(await screen.findByRole('button', { name: 'Generar credencial de datos 🔌' }))

    expect(await screen.findByText('Credencial sin verificar')).toBeInTheDocument()
    expect(body).toBe('')
    expect(screen.getByRole('button', { name: 'Verificar credencial 🔌' })).toBeEnabled()
  })

  it('una sonda fallida (422) lista los permisos de más para el DBA', async () => {
    mockSession({ current: status({ verified_at: null }) })
    server.use(
      http.post(`${BASE}/data-credential/verify`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'La credencial de datos no es SELECT-only.',
              type: 'AppHttpException',
              public_context: {
                code: 'managed_database.data_probe_failed',
                reasons: ['WRITE_PRIVILEGE_PRESENT', 'FEDERATED_TABLE_PRESENT'],
                violations: ['privilege:insert', 'foreign_engine_table'],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = await expand()

    await user.click(await screen.findByRole('button', { name: 'Verificar credencial 🔌' }))

    const callout = (await screen.findByText('La sonda encontró permisos de más')).closest('div')
    expect(callout).not.toBeNull()
    expect(within(callout as HTMLElement).getByText(/Tiene el privilegio INSERT/)).toBeVisible()
    expect(within(callout as HTMLElement).getByText(/FEDERATED/)).toBeVisible()
  })

  it('en production el pedido queda pendiente y el copy exige a OTRO owner', async () => {
    mockSession()
    server.use(
      http.post(`${BASE}/data-access/request`, () =>
        HttpResponse.json({ data: status({ data_access_state: 'pending' }) }),
      ),
    )
    const user = await expand()
    expect(await screen.findByText(/aprobación de OTRO owner/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pedir acceso a datos' }))

    expect(await screen.findByText('Pedido pendiente de aprobación')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprobar acceso a datos' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancelar pedido' })).toBeEnabled()
  })

  it('fuera de production el copy dice que se abre al pedirlo', async () => {
    mockSession({ current: status({ data_access_second_approver_required: false }) })
    await expand()
    expect(await screen.findByText(/se abre al pedirlo, sin segundo aprobador/)).toBeInTheDocument()
  })

  it('aprobar tu propio pedido (403) se explica con el copy de auto-aprobación', async () => {
    mockSession({ current: status({ data_access_state: 'pending' }) })
    server.use(
      http.post(`${BASE}/data-access/approve`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No podés aprobar tu propio pedido.',
              type: 'AppHttpException',
              public_context: { code: 'data_access.self_approval_forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    const user = await expand()

    await user.click(await screen.findByRole('button', { name: 'Aprobar acceso a datos' }))

    expect(await screen.findByText(/No podés aprobar tu propio pedido: lo tiene/)).toBeVisible()
    // El estado sigue pendiente: el error no lo abrió.
    expect(screen.getByText('Pedido pendiente de aprobación')).toBeInTheDocument()
  })

  it('abierto muestra «Cerrar acceso» y lo cierra de inmediato', async () => {
    mockSession({ current: status({ data_access_state: 'open', data_access_allowed: true }) })
    server.use(http.delete(`${BASE}/data-access`, () => HttpResponse.json({ data: status() })))
    const user = await expand()
    expect(await screen.findByText('Lectura de datos abierta')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar acceso' }))

    await waitFor(() => expect(screen.getByText('Lectura de datos cerrada')).toBeInTheDocument())
  })

  it('revocar la credencial pide una confirmación explícita antes de llamar', async () => {
    mockSession()
    let deletes = 0
    server.use(
      http.delete(`${BASE}/data-credential`, () => {
        deletes += 1
        return HttpResponse.json({
          data: status({ has_data_credential: false, verified_at: null }),
        })
      }),
    )
    const user = await expand()

    await user.click(await screen.findByRole('button', { name: 'Revocar credencial 🔌' }))
    expect(deletes).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Confirmar revocación 🔌' }))

    expect(await screen.findByText('Sin credencial de datos')).toBeInTheDocument()
    expect(deletes).toBe(1)
  })

  it('sin servers.admin no deja tocar la credencial y dice por qué', async () => {
    mockSession({ serversAdmin: false })
    await expand()

    expect(await screen.findByRole('button', { name: 'Volver a verificar 🔌' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Regenerar contraseña 🔌' })).toBeDisabled()
    // El acceso sí: depende de otra capacidad.
    expect(screen.getByRole('button', { name: 'Pedir acceso a datos' })).toBeEnabled()
  })

  it('sin data.read no deja pedir ni aprobar el acceso', async () => {
    mockSession({ dataRead: false })
    await expand()

    expect(await screen.findByRole('button', { name: 'Pedir acceso a datos' })).toBeDisabled()
  })
})
