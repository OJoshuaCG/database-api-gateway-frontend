import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import type { ApiTokenOut } from '@/lib/contracts'
import { EditApiTokenScopesModal } from './EditApiTokenScopesModal'

const API = 'http://localhost/api/v1'

const token: ApiTokenOut = {
  id: 12,
  token_id: 'k3f9qm2x',
  name: 'ci-tienda-retail',
  scopes: ['blueprints.read', 'catalogs.read'],
  project_id: 4,
  expires_at: '2026-10-09T12:00:00Z',
  last_used_at: null,
  revoked_at: null,
  note: null,
  active: true,
  created_at: '2026-09-09T12:00:00Z',
}

function mockBackend() {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({ data: meFixture({ global_capabilities: ['access_admin'] }) }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('EditApiTokenScopesModal', () => {
  it('precarga los scopes actuales y deja «Guardar» deshabilitado sin cambios', async () => {
    mockBackend()
    renderWithProviders(<EditApiTokenScopesModal open token={token} onClose={() => {}} />)

    expect(await screen.findByRole('button', { name: 'Quitar blueprints.read' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Quitar catalogs.read' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled()
  })

  it('al quitar y agregar manda el reemplazo completo y cierra', async () => {
    mockBackend()
    let received: unknown = null
    let calledPath: string | null = null
    server.use(
      http.patch(`${API}/api-tokens/:pk`, async ({ params, request }) => {
        calledPath = String(params.pk)
        received = await request.json()
        return HttpResponse.json({
          data: { ...token, scopes: ['blueprints.read', 'clones.read'] },
        })
      }),
    )
    let closed = false
    const user = userEvent.setup()
    renderWithProviders(
      <EditApiTokenScopesModal open token={token} onClose={() => (closed = true)} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Quitar catalogs.read' }))
    await user.click(await screen.findByRole('button', { name: 'clones.read' }))
    await user.click(screen.getByRole('button', { name: 'Guardar permisos' }))

    await waitFor(() => expect(received).toEqual({ scopes: ['blueprints.read', 'clones.read'] }))
    expect(calledPath).toBe('12')
    await waitFor(() => expect(closed).toBe(true))
  })

  it('no deja guardar una lista vacía', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<EditApiTokenScopesModal open token={token} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Quitar blueprints.read' }))
    await user.click(screen.getByRole('button', { name: 'Quitar catalogs.read' }))

    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled()
  })

  it('un 422 scope_not_allowed se muestra con role=alert y el techo del servidor', async () => {
    mockBackend()
    server.use(
      http.patch(`${API}/api-tokens/:pk`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Permiso fuera del techo de agente.',
              type: 'AppHttpException',
              public_context: {
                code: 'api_token.scope_not_allowed',
                allowed: ['blueprints.read', 'catalogs.read'],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<EditApiTokenScopesModal open token={token} onClose={() => {}} />)

    await user.type(await screen.findByLabelText('Añadir permiso'), 'databases.drop')
    await user.click(screen.getByRole('button', { name: 'Añadir' }))
    await user.click(screen.getByRole('button', { name: 'Guardar permisos' }))

    // Hay varios `alert` a la vez (el error del modal, el aviso de ampliar y el toast), así que
    // se busca el que lleva el mensaje del servidor y se mira el del propio modal.
    const alerts = await screen.findAllByText(/fuera del techo de agente/, { selector: 'p' })
    const alert = alerts.find((el) => el.closest('dialog')) as HTMLElement
    expect(alert).toBeDefined()
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('blueprints.read, catalogs.read')
    expect(screen.getByText('Techo de agente informado por el servidor')).toBeInTheDocument()
  })

  it('ante el 403 de step-up pide la contraseña y reenvía el PATCH una sola vez', async () => {
    mockBackend()
    let calls = 0
    server.use(
      http.patch(`${API}/api-tokens/:pk`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json(
            {
              detail: {
                msg: 'Confirmá tu contraseña.',
                type: 'AppHttpException',
                public_context: { code: 'access.step_up_required', step_up_ttl_seconds: 300 },
              },
            },
            { status: 403 },
          )
        }
        return HttpResponse.json({ data: { ...token, scopes: ['blueprints.read'] } })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    let closed = false
    const user = userEvent.setup()
    renderWithProviders(
      <EditApiTokenScopesModal open token={token} onClose={() => (closed = true)} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Quitar catalogs.read' }))
    await user.click(screen.getByRole('button', { name: 'Guardar permisos' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
    await waitFor(() => expect(closed).toBe(true))
  })
})
