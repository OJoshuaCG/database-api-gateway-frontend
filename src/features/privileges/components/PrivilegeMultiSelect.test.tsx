import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { PrivilegeMultiSelect } from './PrivilegeMultiSelect'

const API = 'http://localhost/api/v1'

function privilege(id: number, name: string, isSensitive: boolean) {
  return {
    id,
    engine: 'mysql',
    name,
    category: 'data',
    context: null,
    description: name,
    is_sensitive: isSensitive,
    is_active: true,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  }
}

function mockPrivileges() {
  server.use(
    http.get(`${API}/privileges`, () =>
      HttpResponse.json({
        data: [privilege(1, 'SELECT', false), privilege(2, 'ALL PRIVILEGES', true)],
      }),
    ),
  )
}

describe('PrivilegeMultiSelect: privilegios sensibles bloqueados', () => {
  it('sin bloqueo ofrece los sensibles', async () => {
    mockPrivileges()
    renderWithProviders(<PrivilegeMultiSelect engine="mysql" value={[]} onChange={() => {}} />)
    await userEvent.click(await screen.findByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'ALL PRIVILEGES' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'SELECT' })).toBeInTheDocument()
  })

  it('con bloqueo oculta los sensibles y muestra el motivo', async () => {
    mockPrivileges()
    renderWithProviders(
      <PrivilegeMultiSelect
        engine="mysql"
        value={[]}
        onChange={() => {}}
        sensitiveBlocked
        blockedHint="Falta engine_users.grant_admin."
      />,
    )
    await userEvent.click(await screen.findByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'SELECT' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'ALL PRIVILEGES' })).not.toBeInTheDocument()
    expect(screen.getByText('Falta engine_users.grant_admin.')).toBeInTheDocument()
  })

  it('un sensible ya elegido se conserva para poder quitarlo', async () => {
    mockPrivileges()
    renderWithProviders(
      <PrivilegeMultiSelect
        engine="mysql"
        value={['ALL PRIVILEGES']}
        onChange={() => {}}
        sensitiveBlocked
        blockedHint="Falta engine_users.grant_admin."
      />,
    )
    expect(await screen.findByText('ALL PRIVILEGES')).toBeInTheDocument()
  })
})
