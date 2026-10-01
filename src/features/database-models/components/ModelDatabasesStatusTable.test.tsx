import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { ModelDatabasesStatusTable } from './ModelDatabasesStatusTable'

const API = 'http://localhost/api/v1'
const DATABASES = `${API}/database-models/3/databases`

function db(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'app_prod',
    server_id: 1,
    owner_id: 1,
    model_id: 3,
    status: 'active',
    model_version: '0001',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    pending_count: 0,
    pending_versions: [],
    has_partial_application: false,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function mount(
  databases: Record<string, unknown>[],
  blueprintCollation?: string | null,
  role = 'owner',
) {
  server.use(
    http.get(DATABASES, () => HttpResponse.json({ data: databases })),
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/environments`, () =>
      HttpResponse.json({
        data: [],
        pagination: { page: 1, size: 50, total: 0, pages: 0, has_next: false, has_prev: false },
      }),
    ),
  )
  renderWithProviders(
    <ModelDatabasesStatusTable
      modelId={3}
      blueprintCollation={blueprintCollation}
      onApplyTo={role === 'owner' ? vi.fn() : undefined}
    />,
  )
}

describe('ModelDatabasesStatusTable', () => {
  it('muestra las versiones pendientes de cada BD', async () => {
    mount([db({ pending_count: 2, pending_versions: ['0002', '0003'] })])
    // La tabla se re-pinta cuando llegan la sesión y el catálogo (los guards de sus botones), y
    // eso reemplaza los nodos de las filas: afirmar `toBeInTheDocument()` sobre un nodo encontrado
    // antes puede fallar porque ya se desmontó. Que el `find` resuelva ya prueba que se mostró.
    expect(await screen.findAllByText('2 pendiente(s)')).not.toHaveLength(0)
    expect(await screen.findAllByText('0002, 0003')).not.toHaveLength(0)
  })

  it('marca la aplicación parcial, que la versión actual NO refleja', async () => {
    mount([db({ has_partial_application: true })])
    expect((await screen.findAllByText('aplicación parcial'))[0]).toBeInTheDocument()
  })

  it('ofrece adoptar el collation cuando el blueprint no lo declara y las BDs coinciden', async () => {
    mount([db(), db({ id: 8, name: 'app_stg' })], null)
    expect(
      await screen.findByRole('button', { name: 'Declarar utf8mb4_unicode_ci' }),
    ).toBeInTheDocument()
  })

  it('no lo ofrece si las BDs discrepan: no hay esquema de referencia que deducir', async () => {
    mount([db(), db({ id: 8, name: 'app_stg', collation: 'utf8mb4_bin' })], null)
    await screen.findAllByText('app_prod')
    expect(screen.queryByRole('button', { name: /^Declarar/ })).not.toBeInTheDocument()
  })

  it('no lo ofrece si el blueprint ya declara uno', async () => {
    mount([db()], 'utf8mb4_general_ci')
    await screen.findAllByText('app_prod')
    expect(screen.queryByRole('button', { name: /^Declarar/ })).not.toBeInTheDocument()
  })

  it('no lo ofrece si alguna BD no tiene collation conocido', async () => {
    mount([db(), db({ id: 8, name: 'app_stg', collation: null })], null)
    await screen.findAllByText('app_prod')
    expect(screen.queryByRole('button', { name: /^Declarar/ })).not.toBeInTheDocument()
  })

  it('un viewer ve UN aviso que explica todo, y los botones lo referencian', async () => {
    mount([db(), db({ id: 8, name: 'app_stg' })], null, 'viewer')
    const notice = await screen.findByText(
      'Podés ver en qué versión está cada base, pero no releerlas del motor ni declarar su collation en el blueprint',
    )
    expect(screen.getAllByText(/Pedíselo a quien administra los accesos/)).toHaveLength(1)
    const reread = screen.getByRole('button', { name: /Releer del motor/ })
    expect(reread).toBeDisabled()
    expect(reread.getAttribute('aria-describedby')).toBe(notice.parentElement?.id)
    expect(screen.getByRole('button', { name: 'Declarar utf8mb4_unicode_ci' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Aplicar aquí/ })).not.toBeInTheDocument()
  })

  it('un owner no ve el aviso', async () => {
    mount([db()], 'utf8mb4_general_ci')
    await screen.findAllByText('app_prod')
    expect(screen.queryByText(/^Podés /)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Releer del motor/ })).toBeEnabled()
  })
})
