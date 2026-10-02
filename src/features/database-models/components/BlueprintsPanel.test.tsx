import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture, pageOf } from '@/test/fixtures/authz-catalog'
import { BlueprintsPanel } from './BlueprintsPanel'

const API = 'http://localhost/api/v1'

/** Devuelve «¿ya respondió el catálogo?»: antes de eso la guarda falla abierto por diseño. */
function mount(role: string) {
  let catalogServed = false
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => {
      catalogServed = true
      return HttpResponse.json({ data: CATALOG_FIXTURE })
    }),
    http.get(`${API}/database-models`, () =>
      HttpResponse.json(
        pageOf([
          {
            id: 3,
            name: 'Facturación',
            slug: 'facturacion',
            current_version: '0004',
            is_active: true,
            created_at: '2026-07-01T10:00:00Z',
            updated_at: '2026-07-01T10:00:00Z',
          },
        ]),
      ),
    ),
  )
  renderWithProviders(<BlueprintsPanel />)
  return () => catalogServed
}

describe('BlueprintsPanel — eliminar pide blueprints.apply', () => {
  it('un operator no ve «Eliminar» en las filas y un aviso lo explica una vez', async () => {
    mount('operator')
    expect(
      await screen.findByText('Podés ver los blueprints, pero no eliminarlos'),
    ).toBeInTheDocument()
    expect((await screen.findAllByText('Facturación')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })

  it('un owner sí lo ve, sin aviso', async () => {
    const served = mount('owner')
    await vi.waitFor(() => expect(served()).toBe(true))
    expect((await screen.findAllByRole('button', { name: 'Eliminar' })).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pero no eliminarlos/)).not.toBeInTheDocument()
  })
})
