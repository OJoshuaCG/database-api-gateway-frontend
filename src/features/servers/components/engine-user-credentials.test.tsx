import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { GRANTS_CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { AddEngineUserHostModal } from './AddEngineUserHostModal'
import { AdoptAllHostsModal } from './AdoptAllHostsModal'
import { ChangeEngineUserPasswordModal } from './ChangeEngineUserPasswordModal'

const API = 'http://localhost/api/v1'
const CREDENTIALS = 'engine_users.credentials'
const GRANTABLE = 'Se puede otorgar sola, como capacidad puntual, sin cambiar tu rol.'

/**
 * Sesión con el catálogo de capacidades puntuales (donde `credentials` es otorgable). Devuelve
 * «¿ya respondió el catálogo?»: antes de eso la guarda no puede decidir.
 */
function mockSession(role: string) {
  let catalogServed = false
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => {
      catalogServed = true
      return HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })
    }),
  )
  return () => catalogServed
}

describe('engine_users.credentials: contraseña opcional', () => {
  it('operator: «Agregar host» solo reutiliza la contraseña, con el motivo; agregar sigue habilitado', async () => {
    mockSession('operator')
    renderWithProviders(
      <AddEngineUserHostModal
        onClose={vi.fn()}
        serverId={1}
        username="app"
        sourceHostOptions={['%']}
        defaultSourceHost="%"
      />,
    )
    const hint = await screen.findByText(/Tu acceso no permite elegir una contraseña nueva/)
    expect(hint).toHaveTextContent(CREDENTIALS)
    // La nota de «puntual» llega con el catálogo, después del motivo.
    await vi.waitFor(() => expect(hint).toHaveTextContent(GRANTABLE))
    const reuse = screen.getByRole('switch', { name: /Reutilizar la contraseña/ })
    expect(reuse).toBeDisabled()
    expect(reuse).toBeChecked()
    expect(screen.queryByLabelText(/Nueva contraseña/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar host 🔌' })).toBeEnabled()
  })

  it('owner: puede elegir una contraseña nueva para el host', async () => {
    const served = mockSession('owner')
    renderWithProviders(
      <AddEngineUserHostModal
        onClose={vi.fn()}
        serverId={1}
        username="app"
        sourceHostOptions={['%']}
        defaultSourceHost="%"
      />,
    )
    await vi.waitFor(() => expect(served()).toBe(true))
    const reuse = screen.getByRole('switch', { name: /Reutilizar la contraseña/ })
    await vi.waitFor(() => expect(reuse).toBeEnabled())
    await userEvent.click(reuse)
    expect(screen.getByLabelText(/Nueva contraseña/)).toBeEnabled()
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })

  it('operator: adoptar todos los hosts sin contraseña sigue habilitado y no la envía', async () => {
    mockSession('operator')
    let body: unknown = null
    server.use(
      http.post(`${API}/servers/1/users/adopt-all-hosts`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          { data: { username: 'app', dialect: 'mysql', total_hosts: 1, adopted: 1, results: [] } },
          { status: 201 },
        )
      }),
    )
    renderWithProviders(
      <AdoptAllHostsModal onClose={vi.fn()} serverId={1} username="app" supportsHosts />,
    )
    const hint = await screen.findByText(
      /Tu acceso no permite guardar una contraseña conocida al adoptar/,
    )
    expect(hint).toHaveTextContent(CREDENTIALS)
    // La nota de «puntual» llega con el catálogo, después del motivo.
    await vi.waitFor(() => expect(hint).toHaveTextContent(GRANTABLE))
    expect(screen.getByLabelText(/Contraseña conocida/)).toBeDisabled()

    const submit = screen.getByRole('button', { name: 'Adoptar todos los hosts 🔌' })
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await vi.waitFor(() => expect(body).not.toBeNull())
    expect(body).not.toHaveProperty('known_password')
  })

  it('owner: el campo de contraseña conocida queda habilitado, sin motivo', async () => {
    const served = mockSession('owner')
    renderWithProviders(
      <AdoptAllHostsModal onClose={vi.fn()} serverId={1} username="app" supportsHosts />,
    )
    await vi.waitFor(() => expect(served()).toBe(true))
    await vi.waitFor(() => expect(screen.getByLabelText(/Contraseña conocida/)).toBeEnabled())
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })
})

describe('engine_users.credentials: contraseña obligatoria', () => {
  it('operator: rotar una contraseña queda deshabilitado entero, con el motivo', async () => {
    mockSession('operator')
    renderWithProviders(
      <ChangeEngineUserPasswordModal
        onClose={vi.fn()}
        serverId={1}
        username="app"
        host="%"
        alreadyAdopted
      />,
    )
    const hint = await screen.findByText(/Tu acceso no permite cambiar contraseñas del motor/)
    expect(hint).toHaveTextContent(CREDENTIALS)
    // La nota de «puntual» llega con el catálogo, después del motivo.
    await vi.waitFor(() => expect(hint).toHaveTextContent(GRANTABLE))
    expect(screen.getByRole('button', { name: 'Cambiar contraseña 🔌' })).toBeDisabled()
  })

  it('owner: rotar queda habilitado', async () => {
    const served = mockSession('owner')
    renderWithProviders(
      <ChangeEngineUserPasswordModal
        onClose={vi.fn()}
        serverId={1}
        username="app"
        host="%"
        alreadyAdopted
      />,
    )
    await vi.waitFor(() => expect(served()).toBe(true))
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cambiar contraseña 🔌' })).toBeEnabled(),
    )
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })
})
