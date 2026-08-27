import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { ModelMigrationDetailPanel } from './ModelMigrationDetailPanel'

const BASE = 'http://localhost/api/v1/database-models/3/migrations/0001'

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    model_id: 3,
    version: '0001',
    name: 'Esquema inicial',
    up_sql: 'CREATE TABLE orders (id INT PRIMARY KEY)',
    up_sql_mysql: null,
    up_sql_postgresql: null,
    down_sql: null,
    down_sql_suggested: 'DROP TABLE IF EXISTS orders;',
    translated: { mysql: 'CREATE TABLE orders (id INT PRIMARY KEY)' },
    checksum: 'abc123',
    reviewed: true,
    capture_selects: false,
    sql_frozen: false,
    deletable: true,
    block_reason: null,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    sql_diverged: false,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function mount(overrides: Record<string, unknown> = {}) {
  server.use(http.get(BASE, () => HttpResponse.json({ data: detail(overrides) })))
  renderWithProviders(
    <ModelMigrationDetailPanel modelId={3} version="0001" onCreateNewVersion={vi.fn()} />,
  )
}

describe('ModelMigrationDetailPanel', () => {
  it('se abre en LECTURA: sin formulario y con un «Editar» explícito', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument()
    // Antes montaba el formulario para cualquier versión, y navegar entre ellas parecía una
    // invitación a editarlas —incluidas las que el backend iba a rechazar—.
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('«Editar» abre el formulario y «Cancelar» vuelve a lectura', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument(),
    )
  })

  it('con el SQL congelado lo dice ANTES de entrar a editar', async () => {
    mount({ sql_frozen: true, block_reason: 'applied', deletable: false })
    expect(await screen.findByText(/SQL de esta versión está congelado/)).toBeInTheDocument()
  })

  it('el bloqueo del up_sql llega del backend, no de un 409 posterior', async () => {
    const user = userEvent.setup()
    mount({ sql_frozen: true, block_reason: 'applied', deletable: false })
    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    // El aviso de fix-forward aparece sin haber intentado guardar nada.
    expect(screen.getByText(/aplicó con éxito/)).toBeInTheDocument()
  })

  // El borrado, los resultados capturados y las insignias de estado se mudaron a
  // `VersionFactsCard`: sus casos viven en `VersionFactsCard.test.tsx`. Acá queda lo que el panel
  // sigue siendo dueño de hacer — abrirse en lectura y el ciclo de edición.
})
