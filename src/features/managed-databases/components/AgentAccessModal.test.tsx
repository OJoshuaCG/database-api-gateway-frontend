import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, managedDatabaseFixture, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import { AgentAccessModal } from './AgentAccessModal'

const API = 'http://localhost/api/v1'
const AGENT_ACCESS_URL = `${API}/managed-databases/11/agent-access`

/** Sesión con `environments.write` (solo la da `security_officer`) o sin ella. */
function mockSession({ canWrite }: { canWrite: boolean }) {
  const me = canWrite
    ? meFixture({ global_capabilities: ['security_officer'] })
    : meFixture({ role: 'owner' })
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('AgentAccessModal', () => {
  it('precarga el estado actual y deja «Guardar» deshabilitado sin cambios', () => {
    mockSession({ canWrite: true })
    renderWithProviders(
      <AgentAccessModal
        database={managedDatabaseFixture({ agent_access_allowed: true })}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('switch', { name: 'Permitir agentes' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Bloqueo de emergencia' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('manda siempre los dos flags y cierra al guardar', async () => {
    mockSession({ canWrite: true })
    let received: unknown = null
    server.use(
      http.put(AGENT_ACCESS_URL, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ data: managedDatabaseFixture({ agent_access_allowed: true }) })
      }),
    )
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<AgentAccessModal database={managedDatabaseFixture()} onClose={onClose} />)

    await user.click(screen.getByRole('switch', { name: 'Permitir agentes' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(received).toEqual({ allowed: true, blocked: false }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('con permiso y bloqueo a la vez avisa que el bloqueo gana, y manda ambos', async () => {
    mockSession({ canWrite: true })
    let received: unknown = null
    server.use(
      http.put(AGENT_ACCESS_URL, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ data: managedDatabaseFixture() })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <AgentAccessModal
        database={managedDatabaseFixture({ agent_access_allowed: true })}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('switch', { name: 'Bloqueo de emergencia' }))

    // Puede haber más de un `role="alert"` a la vez: se busca el Callout por su título.
    expect(await screen.findByText('El bloqueo anula el permiso')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(received).toEqual({ allowed: true, blocked: true }))
  })

  it('sin `environments.write` deshabilita todo y dice por qué', async () => {
    mockSession({ canWrite: false })
    renderWithProviders(<AgentAccessModal database={managedDatabaseFixture()} onClose={vi.fn()} />)

    expect(await screen.findByText(/cambiar el acceso de agentes de esta base/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Permitir agentes' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Bloqueo de emergencia' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('ante el 403 de step-up pide la contraseña y reenvía el PUT una sola vez', async () => {
    mockSession({ canWrite: true })
    let calls = 0
    server.use(
      http.put(AGENT_ACCESS_URL, () => {
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
        return HttpResponse.json({ data: managedDatabaseFixture({ agent_access_allowed: true }) })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<AgentAccessModal database={managedDatabaseFixture()} onClose={onClose} />)

    await user.click(screen.getByRole('switch', { name: 'Permitir agentes' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
