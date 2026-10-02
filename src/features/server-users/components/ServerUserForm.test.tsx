import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  GRANTS_CATALOG_FIXTURE,
  meFixture,
  pageOf,
  serverFixture,
} from '@/test/fixtures/authz-catalog'
import { ServerUserForm } from './ServerUserForm'

const API = 'http://localhost/api/v1'

function mockSession(role: string) {
  let catalogServed = false
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => {
      catalogServed = true
      return HttpResponse.json({ data: GRANTS_CATALOG_FIXTURE })
    }),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(1, 'db1')]))),
  )
  return () => catalogServed
}

function renderEdit(onSubmit = vi.fn()) {
  renderWithProviders(
    <ServerUserForm
      mode="edit"
      defaultValues={{ is_active: true, notes: '', password: '', provision: false }}
      readonlyIdentity={{ username: 'app', host: '%', serverName: 'db1' }}
      serverId={1}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  )
  return onSubmit
}

describe('ServerUserForm: la contraseña pide engine_users.credentials', () => {
  it('operator: contraseña y aprovisionar deshabilitados con el motivo; guardar sin contraseña sigue', async () => {
    mockSession('operator')
    const onSubmit = renderEdit()
    const hint = await screen.findByText(/Tu acceso no permite cambiar la contraseña/)
    expect(hint).toHaveTextContent('engine_users.credentials')
    // La nota de «puntual» llega con el catálogo, después del motivo.
    await vi.waitFor(() =>
      expect(hint).toHaveTextContent(
        'Se puede otorgar sola, como capacidad puntual, sin cambiar tu rol.',
      ),
    )
    expect(screen.getByLabelText(/Contraseña/)).toBeDisabled()
    expect(screen.getByRole('switch', { name: /Aprovisionar en el motor/ })).toBeDisabled()

    const save = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ password: '', provision: false })
  })

  it('owner: contraseña y aprovisionar habilitados, sin motivo', async () => {
    const served = mockSession('owner')
    renderEdit()
    await vi.waitFor(() => expect(served()).toBe(true))
    await vi.waitFor(() => expect(screen.getByLabelText(/Contraseña/)).toBeEnabled())
    expect(screen.getByRole('switch', { name: /Aprovisionar en el motor/ })).toBeEnabled()
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })
})
