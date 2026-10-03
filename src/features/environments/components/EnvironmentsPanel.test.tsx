import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  CATALOG_FIXTURE,
  environmentFixture,
  meFixture,
  pageOf,
} from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import { ENVIRONMENTS_WRITE_UNBLOCK } from '../messages'
import { EnvironmentsPanel } from './EnvironmentsPanel'

const API = 'http://localhost/api/v1'

/** Sesión con `environments.write` (la da `security_officer`) o sin ella. */
function mockSession({ canWrite }: { canWrite: boolean }) {
  const me = canWrite
    ? meFixture({ global_capabilities: ['security_officer'] })
    : meFixture({ role: 'owner' })
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

function mockEnvironments(allows: boolean) {
  server.use(
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([{ ...environmentFixture(4, 'Production', 3), allows_agent_access: allows }]),
      ),
    ),
  )
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('EnvironmentsPanel', () => {
  it('dice quién escribe entornos y cómo desbloquearlo cuando nadie es security_officer', async () => {
    server.use(
      http.get('http://localhost/api/v1/environments', () =>
        HttpResponse.json(pageOf([environmentFixture(1, 'Desarrollo', 0)])),
      ),
    )
    renderWithProviders(<EnvironmentsPanel />)
    expect(await screen.findByText(ENVIRONMENTS_WRITE_UNBLOCK)).toBeVisible()
    expect(ENVIRONMENTS_WRITE_UNBLOCK).toContain('Usuarios → Accesos')
  })

  it('encender pide reescribir el slug y lo manda como query confirm_slug', async () => {
    mockSession({ canWrite: true })
    mockEnvironments(false)
    let confirmSlug: string | null = null
    let body: unknown = null
    server.use(
      http.patch(`${API}/environments/4`, async ({ request }) => {
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        body = await request.json()
        return HttpResponse.json({
          data: { ...environmentFixture(4, 'Production', 3), allows_agent_access: true },
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<EnvironmentsPanel />)

    await user.click(await screen.findByRole('button', { name: /Permitir agentes en Production/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/no abre ninguna base/)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Permitir agentes' })
    expect(confirm).toBeDisabled()

    await user.type(
      within(dialog).getByLabelText(/Escribí «production» para confirmar/),
      'production',
    )
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await waitFor(() => expect(confirmSlug).toBe('production'))
    expect(body).toEqual({ allows_agent_access: true })
  })

  it('apagar no pide confirmación ni manda confirm_slug', async () => {
    mockSession({ canWrite: true })
    mockEnvironments(true)
    let hit = false
    let confirmSlug: string | null = 'sin-llamar'
    let body: unknown = null
    server.use(
      http.patch(`${API}/environments/4`, async ({ request }) => {
        hit = true
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        body = await request.json()
        return HttpResponse.json({ data: environmentFixture(4, 'Production', 3) })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<EnvironmentsPanel />)

    await user.click(await screen.findByRole('button', { name: /Cerrar a agentes en Production/ }))

    await waitFor(() => expect(hit).toBe(true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(confirmSlug).toBeNull()
    expect(body).toEqual({ allows_agent_access: false })
  })

  it('un 422 confirmation_required muestra el slug esperado y qué se debilita', async () => {
    mockSession({ canWrite: true })
    mockEnvironments(false)
    server.use(
      http.patch(`${API}/environments/4`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Confirmación requerida.',
              type: 'AppHttpException',
              public_context: {
                code: 'environment.confirmation_required',
                expected_slug: 'production',
                weakened: ['allows_agent_access'],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<EnvironmentsPanel />)

    await user.click(await screen.findByRole('button', { name: /Permitir agentes en Production/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText(/Escribí «production» para confirmar/),
      'production',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Permitir agentes' }))

    // Hay un toast y el Callout a la vez, los dos `role="alert"`: se busca por contenido.
    expect(
      await within(dialog).findByText(/Identificador esperado: production/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('allows_agent_access')).toBeInTheDocument()
  })

  it('sin `environments.write` deshabilita el botón y dice por qué', async () => {
    mockSession({ canWrite: false })
    mockEnvironments(false)
    renderWithProviders(<EnvironmentsPanel />)

    expect(
      await screen.findByText(/cambiar el acceso de agentes de un entorno/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Permitir agentes en Production/ })).toBeDisabled()
  })

  it('ante el 403 de step-up pide la contraseña y reenvía el PATCH una sola vez', async () => {
    mockSession({ canWrite: true })
    mockEnvironments(true)
    let calls = 0
    server.use(
      http.patch(`${API}/environments/4`, () => {
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
        return HttpResponse.json({ data: environmentFixture(4, 'Production', 3) })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    const user = userEvent.setup()
    renderWithProviders(<EnvironmentsPanel />)

    await user.click(await screen.findByRole('button', { name: /Cerrar a agentes en Production/ }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
  })
})
