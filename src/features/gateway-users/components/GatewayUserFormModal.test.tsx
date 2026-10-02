import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import type { GatewayUserOut } from '@/lib/contracts'
import { SELF_ACCESS_NOTE } from '../self-access'
import { GatewayUserFormModal } from './GatewayUserFormModal'

const user: GatewayUserOut = {
  id: 1,
  username: 'admin',
  email: 'admin@empresa.com',
  full_name: null,
  gateway_role: 'owner',
  is_active: true,
  credential_set: true,
  global_capabilities: ['access_admin'],
  scope_grants: [],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

function mockActor(role: string) {
  server.use(
    http.get('http://localhost/api/v1/auth/me', () =>
      HttpResponse.json({ data: meFixture({ role, global_capabilities: ['access_admin'] }) }),
    ),
    http.get('http://localhost/api/v1/authz/catalog', () =>
      HttpResponse.json({ data: CATALOG_FIXTURE }),
    ),
  )
}

beforeEach(() => mockActor('owner'))

describe('GatewayUserFormModal — rol base', () => {
  it('resume qué otorga el rol elegido desde el catálogo, sin descripciones escritas a mano', async () => {
    renderWithProviders(<GatewayUserFormModal open onClose={() => undefined} />)
    expect(await screen.findByText(/Otorga 12 de 31/)).toBeInTheDocument()
    // La frase vieja prometía que se podía «acotar o ampliar»: hoy no se cumple en todas las rutas.
    expect(screen.queryByText(/acotar o ampliar/)).not.toBeInTheDocument()
  })

  it('no ofrece un rol base por encima del de quien crea la cuenta', async () => {
    mockActor('operator')
    renderWithProviders(<GatewayUserFormModal open onClose={() => undefined} />)
    expect(
      await screen.findByText(/Solo podés asignar un rol base hasta operator/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(screen.getByRole('option', { name: 'operator' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'owner' })).not.toBeInTheDocument()
  })
})

describe('GatewayUserFormModal — edición de la propia cuenta', () => {
  it('deshabilita el estado de la cuenta con el motivo a la vista', () => {
    renderWithProviders(
      <GatewayUserFormModal open user={user} currentUserId={1} onClose={() => undefined} />,
    )
    expect(screen.getByRole('switch', { name: 'Cuenta activa' })).toBeDisabled()
    // Una nota por control deshabilitado: rol base y estado.
    expect(screen.getAllByText(SELF_ACCESS_NOTE).length).toBeGreaterThanOrEqual(2)
    // El correo sigue editable: los datos de contacto sí se pueden cambiar sobre uno mismo.
    expect(screen.getByLabelText('Correo')).toBeEnabled()
  })

  it('sobre otra cuenta el estado sigue editable', () => {
    renderWithProviders(
      <GatewayUserFormModal open user={user} currentUserId={99} onClose={() => undefined} />,
    )
    expect(screen.getByRole('switch', { name: 'Cuenta activa' })).toBeEnabled()
    expect(screen.queryByText(SELF_ACCESS_NOTE)).not.toBeInTheDocument()
  })
})
