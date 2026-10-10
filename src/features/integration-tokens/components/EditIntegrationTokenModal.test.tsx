import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { pageOf, serverFixture } from '@/test/fixtures/authz-catalog'
import type { IntegrationTokenOut } from '@/lib/contracts'
import { EditIntegrationTokenModal } from './EditIntegrationTokenModal'

const API = 'http://localhost/api/v1'

const CEILING = {
  enabled: true,
  scopes: [
    { scope: 'servers.list', label: 'Listar servidores permitidos', mutates: false, tier: 'read' },
    { scope: 'databases.create', label: 'Crear una base de datos', mutates: true, tier: 'write' },
    {
      scope: 'migrations.rollback',
      label: 'Revertir migraciones (puede borrar datos de forma irreversible)',
      mutates: true,
      tier: 'destructive',
    },
  ],
  max_ttl_days: 90,
  max_write_ttl_days: 30,
  max_destructive_ttl_days: 7,
}

function tokenFixture(overrides: Partial<IntegrationTokenOut> = {}): IntegrationTokenOut {
  return {
    id: 9,
    token_id: 'ab12cd34',
    name: 'web-tienda',
    scopes: ['servers.list'],
    suspended_scopes: [],
    server_ids: [1],
    blueprint_ids: [],
    created_by_admin_id: 3,
    expires_at: '2027-01-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    note: null,
    active: true,
    created_at: '2026-10-10T12:00:00Z',
    ...overrides,
  }
}

function mockBackend() {
  const patchRequests: unknown[] = []
  server.use(
    http.get(`${API}/integration-tokens/ceiling`, () => HttpResponse.json({ data: CEILING })),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(1, 'prod-mysql')]))),
    http.get(`${API}/database-models`, () => HttpResponse.json(pageOf([]))),
    http.patch(`${API}/integration-tokens/9`, async ({ request }) => {
      patchRequests.push(await request.json())
      return HttpResponse.json({ data: tokenFixture() })
    }),
  )
  return patchRequests
}

describe('EditIntegrationTokenModal', () => {
  it('sin cambios no deja guardar', async () => {
    mockBackend()
    renderWithProviders(
      <EditIntegrationTokenModal open token={tokenFixture()} onClose={() => {}} />,
    )

    await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ })
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('manda solo lo que cambió y cierra al guardar', async () => {
    const patchRequests = mockBackend()
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<EditIntegrationTokenModal open token={tokenFixture()} onClose={onClose} />)

    await user.click(await screen.findByRole('checkbox', { name: /Crear una base de datos/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(patchRequests).toEqual([{ scopes: ['servers.list', 'databases.create'] }])
  })

  it('muestra los scopes suspendidos como no elegibles', async () => {
    mockBackend()
    renderWithProviders(
      <EditIntegrationTokenModal
        open
        token={tokenFixture({ suspended_scopes: ['databases.drop'] })}
        onClose={() => {}}
      />,
    )

    expect(await screen.findByText('databases.drop')).toBeInTheDocument()
    expect(screen.getByText('suspendido')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /databases\.drop/ })).not.toBeInTheDocument()
  })

  it('avisa que el vencimiento no cambia y que ampliar permisos puede ser rechazado', async () => {
    mockBackend()
    renderWithProviders(
      <EditIntegrationTokenModal open token={tokenFixture()} onClose={() => {}} />,
    )

    expect(await screen.findByText(/El vencimiento no se puede cambiar/)).toBeInTheDocument()
  })

  it('con un scope destructivo ya elegido exige la confirmación para guardar un cambio', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(
      <EditIntegrationTokenModal
        open
        token={tokenFixture({ scopes: ['migrations.rollback'], blueprint_ids: [5] })}
        onClose={() => {}}
      />,
    )

    await user.type(await screen.findByLabelText(/Nombre/), '-v2')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    )
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })

  it('muestra el máximo de días que informa el servidor ante un 422 ttl_too_long', async () => {
    mockBackend()
    server.use(
      http.patch(`${API}/integration-tokens/9`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'ttl',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.ttl_too_long', max_days: 30 },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <EditIntegrationTokenModal open token={tokenFixture()} onClose={() => {}} />,
    )

    await user.click(await screen.findByRole('checkbox', { name: /Crear una base de datos/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    const messages = await screen.findAllByText(/\(30 días\)/)
    expect(messages.length).toBeGreaterThan(0)
  })
})
