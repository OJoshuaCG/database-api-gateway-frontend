import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { ModelDatabasesStatusTable } from './ModelDatabasesStatusTable'

const DATABASES = 'http://localhost/api/v1/database-models/3/databases'

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

function mount(databases: Record<string, unknown>[], blueprintCollation?: string | null) {
  server.use(http.get(DATABASES, () => HttpResponse.json({ data: databases })))
  renderWithProviders(
    <ModelDatabasesStatusTable
      modelId={3}
      blueprintCollation={blueprintCollation}
      onApplyTo={vi.fn()}
    />,
  )
}

describe('ModelDatabasesStatusTable', () => {
  it('muestra las versiones pendientes de cada BD', async () => {
    mount([db({ pending_count: 2, pending_versions: ['0002', '0003'] })])
    expect((await screen.findAllByText('2 pendiente(s)'))[0]).toBeInTheDocument()
    expect((await screen.findAllByText('0002, 0003'))[0]).toBeInTheDocument()
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
})
