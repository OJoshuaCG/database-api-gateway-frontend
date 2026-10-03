import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture, pageOf } from '@/test/fixtures/authz-catalog'
import type { ManagedDatabaseOut } from '@/lib/contracts'
import { ReassignOwnerModal } from './ReassignOwnerModal'

const API = 'http://localhost/api/v1'

const DATABASE: ManagedDatabaseOut = {
  id: 11,
  name: 'ventas_prod',
  server_id: 1,
  owner_id: 5,
  environment_id: 3,
  status: 'active',
  agent_access_allowed: false,
  agent_access_blocked: false,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
}

/** Devuelve «¿ya respondió el catálogo?»: antes de eso la guarda falla abierto por diseño. */
function mockSession(role: string) {
  let catalogServed = false
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => {
      catalogServed = true
      return HttpResponse.json({ data: CATALOG_FIXTURE })
    }),
    http.get(`${API}/server-users`, () => HttpResponse.json(pageOf([]))),
  )
  return () => catalogServed
}

describe('ReassignOwnerModal', () => {
  it('un operator no puede encender «Aplicar en el motor»: pide databases.drop, con el motivo', async () => {
    mockSession('operator')
    renderWithProviders(<ReassignOwnerModal database={DATABASE} onClose={vi.fn()} />)
    const hint = await screen.findByText(
      /Tu acceso no permite aplicar el cambio de propietario en el motor/,
    )
    expect(hint).toHaveTextContent('databases.drop')
    expect(screen.getByRole('switch', { name: 'Aplicar en el motor 🔌' })).toBeDisabled()
    // Reasignar solo en el inventario (`databases.write`) le sigue estando permitido.
    expect(screen.queryByText(/Tu acceso no permite reasignar/)).not.toBeInTheDocument()
  })

  it('un owner puede encenderlo, y no ve ningún motivo', async () => {
    const served = mockSession('owner')
    renderWithProviders(<ReassignOwnerModal database={DATABASE} onClose={vi.fn()} />)
    await vi.waitFor(() => expect(served()).toBe(true))
    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Aplicar en el motor 🔌' })).toBeEnabled(),
    )
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
    expect(screen.getByText(/Revoca\/otorga privilegios/)).toBeInTheDocument()
  })
})
