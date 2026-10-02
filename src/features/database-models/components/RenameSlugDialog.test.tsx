import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { RenameSlugDialog } from './RenameSlugDialog'

const API = 'http://localhost/api/v1'

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

describe('RenameSlugDialog — capacidad de ejecutar (v23 §4.1)', () => {
  it.each([
    ['rename-slug', /Tu acceso no permite renombrar el slug de un blueprint/],
    ['migrate-format', /Tu acceso no permite actualizar el formato de las tablas de versión/],
  ] as const)(
    'en %s, un operator ve desde el primer paso que ejecutar pide blueprints.apply',
    async (mode, reason) => {
      mockSession('operator')
      renderWithProviders(
        mode === 'rename-slug' ? (
          <RenameSlugDialog
            modelId={3}
            currentSlug="ventas"
            onClose={vi.fn()}
            onRenamed={vi.fn()}
          />
        ) : (
          <RenameSlugDialog mode="migrate-format" modelId={3} onClose={vi.fn()} />
        ),
      )
      expect(await screen.findByText(reason)).toHaveTextContent('blueprints.apply')
    },
  )

  it('el plan sigue en blueprints.write: un operator puede pedirlo', async () => {
    mockSession('operator')
    renderWithProviders(<RenameSlugDialog mode="migrate-format" modelId={3} onClose={vi.fn()} />)
    await screen.findByText(/Tu acceso no permite actualizar el formato/)
    expect(screen.getByRole('button', { name: 'Comprobar qué hay que actualizar' })).toBeEnabled()
  })

  it('un owner no ve ningún motivo', async () => {
    const served = mockSession('owner')
    renderWithProviders(<RenameSlugDialog mode="migrate-format" modelId={3} onClose={vi.fn()} />)
    await vi.waitFor(() => expect(served()).toBe(true))
    await screen.findByRole('button', { name: 'Comprobar qué hay que actualizar' })
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })
})
