import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import type { DatabaseModelOut } from '@/lib/contracts'
import { DeleteDatabaseModelDialog } from './DeleteDatabaseModelDialog'

const API = 'http://localhost/api/v1'

const MODEL: DatabaseModelOut = {
  id: 3,
  name: 'Facturación',
  slug: 'facturacion',
  current_version: '0004',
  is_active: true,
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
  )
  return () => catalogServed
}

describe('DeleteDatabaseModelDialog', () => {
  it('un operator ve «Eliminar» deshabilitado con el motivo: pide blueprints.apply', async () => {
    mockSession('operator')
    renderWithProviders(<DeleteDatabaseModelDialog model={MODEL} onClose={vi.fn()} />)
    const hint = await screen.findByText(/Tu acceso no permite eliminar blueprints/)
    expect(hint).toHaveTextContent('blueprints.apply')
    const confirm = screen.getByRole('button', { name: 'Eliminar' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription(hint.textContent ?? '')
  })

  it('un owner lo tiene habilitado y sin motivo', async () => {
    const served = mockSession('owner')
    renderWithProviders(<DeleteDatabaseModelDialog model={MODEL} onClose={vi.fn()} />)
    await vi.waitFor(() => expect(served()).toBe(true))
    await screen.findByText(/Se eliminará «Facturación»/)
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeEnabled()
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })

  it('el 409 database_model.in_use nombra las bases en el diálogo, sin toast, y no deja reintentar', async () => {
    const served = mockSession('owner')
    server.use(
      http.delete(`${API}/database-models/3`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No se puede eliminar el blueprint: 2 base(s) de datos gestionada(s) lo usan.',
              type: 'AppHttpException',
              public_context: {
                code: 'database_model.in_use',
                managed_database_count: 2,
                blocking_databases: [
                  { id: 7, name: 'fact_prod' },
                  { id: 8, name: 'fact_qa' },
                ],
              },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const onClose = vi.fn()
    renderWithProviders(<DeleteDatabaseModelDialog model={MODEL} onClose={onClose} />)
    await vi.waitFor(() => expect(served()).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    expect(
      await screen.findByText(
        'No se puede eliminar: lo usan 2 bases gestionadas: «fact_prod» y «fact_qa». Desasocialas o eliminalas primero.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('No se pudo eliminar el blueprint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
