import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import { DatabaseDestructiveSection } from './DatabaseDestructiveSection'

const API = 'http://localhost/api/v1'
const DB_ID = 7
const APPLY_URL = `${API}/managed-databases/${DB_ID}/migrations/apply`

function planFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    direction: 'up',
    requires_confirmation: true,
    executor_allowed: true,
    all_approved: true,
    versions: [
      {
        version: '0003',
        migration_id: 11,
        sql_hash: 'a'.repeat(64),
        reasons: ['DROP TABLE'],
        approval_status: 'approved',
        approval_id: 5,
        approval_scope: 'database',
      },
    ],
    confirm_token: 'token-del-dry-run',
    expires_at: '2026-10-25T10:05:00Z',
    confirm_name_expected: 'ventas',
    ...overrides,
  }
}

function dryRunBody(plan: ReturnType<typeof planFixture>) {
  return { data: { managed_database_id: DB_ID, dry_run: true, destructive_plan: plan } }
}

function mockOwner() {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role: 'owner' }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

function mount() {
  return renderWithProviders(
    <DatabaseDestructiveSection
      databaseId={DB_ID}
      serverId={1}
      environmentId={2}
      currentVersion="0003"
      rollbackTarget=""
      blockedReason={null}
    />,
  )
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('DatabaseDestructiveSection', () => {
  it('S38: con una versión sin aprobar, ejecutar queda deshabilitado y explica cómo seguir', async () => {
    mockOwner()
    server.use(
      http.post(APPLY_URL, () =>
        HttpResponse.json(
          dryRunBody(
            planFixture({
              all_approved: false,
              confirm_token: null,
              versions: [
                {
                  version: '0003',
                  migration_id: 11,
                  sql_hash: 'a'.repeat(64),
                  reasons: ['DROP TABLE'],
                  approval_status: 'unapproved',
                  approval_id: null,
                  approval_scope: null,
                },
              ],
            }),
          ),
        ),
      ),
    )
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: 'Planificar apply' }))

    expect(await screen.findByText('Faltan aprobaciones: no se puede ejecutar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir a las aprobaciones →' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar con confirmación…' })).toBeDisabled()
  })

  it('S39: si el token venció al ejecutar, pide planificar de nuevo y no un fallo genérico', async () => {
    mockOwner()
    server.use(
      http.post(APPLY_URL, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('dry_run') === 'true') {
          return HttpResponse.json(dryRunBody(planFixture()))
        }
        return HttpResponse.json(
          {
            detail: {
              msg: 'La confirmación venció',
              type: 'AppHttpException',
              public_context: { code: 'destructive_approval.confirmation_expired' },
            },
          },
          { status: 410 },
        )
      }),
    )
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: 'Planificar apply' }))
    await user.click(await screen.findByRole('button', { name: 'Aplicar con confirmación…' }))
    await user.type(await screen.findByLabelText(/Escribí ventas para confirmar/), 'ventas')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(await screen.findByText('Hay que volver a planificar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a planificar' })).toBeInTheDocument()
  })

  it('manda el token del dry-run y el nombre re-tipeado al ejecutar', async () => {
    mockOwner()
    let executedQuery: URLSearchParams | null = null
    server.use(
      http.post(APPLY_URL, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('dry_run') === 'true') {
          return HttpResponse.json(dryRunBody(planFixture()))
        }
        executedQuery = url.searchParams
        return HttpResponse.json({
          data: { managed_database_id: DB_ID, applied_count: 1, no_op: false },
        })
      }),
    )
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: 'Planificar apply' }))
    await user.click(await screen.findByRole('button', { name: 'Aplicar con confirmación…' }))
    await user.type(await screen.findByLabelText(/Escribí ventas para confirmar/), 'ventas')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await screen.findByRole('button', { name: 'Planificar apply' })
    expect(executedQuery).not.toBeNull()
    expect(executedQuery!.get('confirm_token')).toBe('token-del-dry-run')
    expect(executedQuery!.get('confirm_name')).toBe('ventas')
  })
})
