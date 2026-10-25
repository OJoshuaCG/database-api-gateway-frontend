import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { DestructiveApprovalsPanel } from './DestructiveApprovalsPanel'

const API = 'http://localhost/api/v1'
const MODEL_ID = 3

const ACTOR = { admin_id: 1, username: 'ana' }

function versionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    migration_id: 11,
    version: '0003',
    name: 'drop legacy table',
    direction: 'up',
    sql_hash: 'a'.repeat(64),
    reasons_by_engine: { mysql: ['DROP TABLE'] },
    author: ACTOR,
    last_sql_editor: ACTOR,
    author_unknown: false,
    approval_status: 'unapproved',
    effective_approval_id: null,
    approvals: [],
    ...overrides,
  }
}

function mockSession(role: 'owner' | 'viewer') {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

function mockVersions(rows: ReturnType<typeof versionFixture>[]) {
  server.use(
    http.get(`${API}/database-models/${MODEL_ID}/destructive-versions`, () =>
      HttpResponse.json({ data: rows }),
    ),
  )
}

describe('DestructiveApprovalsPanel', () => {
  it('muestra el estado de aprobación de cada versión destructiva', async () => {
    mockSession('owner')
    mockVersions([
      versionFixture(),
      versionFixture({ migration_id: 12, version: '0004', approval_status: 'stale_hash' }),
    ])
    renderWithProviders(<DestructiveApprovalsPanel modelId={MODEL_ID} modelName="core" />)

    expect(await screen.findByText('Sin aprobar')).toBeInTheDocument()
    expect(screen.getByText('Aprobación vencida (SQL cambió)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprobar de nuevo…' })).toBeInTheDocument()
  })

  it('S37: sin `blueprints.approve_destructive` no hay botón de aprobar', async () => {
    mockSession('viewer')
    mockVersions([versionFixture()])
    renderWithProviders(<DestructiveApprovalsPanel modelId={MODEL_ID} modelName="core" />)

    expect(await screen.findByText('Sin aprobar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument()
  })

  it('una versión ya aprobada no ofrece aprobar, y deja revocar la aprobación vigente', async () => {
    mockSession('owner')
    mockVersions([
      versionFixture({
        approval_status: 'approved',
        effective_approval_id: 5,
        approvals: [
          {
            id: 5,
            model_migration_id: 11,
            database_model_id: MODEL_ID,
            version: '0003',
            direction: 'up',
            scope: 'blueprint',
            managed_database_id: null,
            sql_hash: 'a'.repeat(64),
            hash_basis: 'raw_source_v1',
            destructive_summary: null,
            author: ACTOR,
            last_sql_editor: ACTOR,
            author_unknown: false,
            reason: 'revisado con el equipo',
            approved_by: { admin_id: 2, username: 'beto' },
            approved_at: '2026-10-25T10:00:00Z',
            is_live: true,
            execution_count: 0,
          },
        ],
      }),
    ])
    renderWithProviders(<DestructiveApprovalsPanel modelId={MODEL_ID} modelName="core" />)

    expect(await screen.findByText('Aprobada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobar…' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revocar…' })).toBeInTheDocument()
  })

  it('sin versiones destructivas lo dice en vez de mostrar una lista vacía', async () => {
    mockSession('owner')
    mockVersions([])
    renderWithProviders(<DestructiveApprovalsPanel modelId={MODEL_ID} modelName="core" />)

    expect(await screen.findByText(/no hay nada que aprobar/)).toBeInTheDocument()
  })
})
