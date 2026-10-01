import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
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
