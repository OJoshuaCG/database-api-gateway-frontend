import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, managedDatabaseFixture, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import type { ServerOut } from '@/lib/contracts'
import { AgentAccessModal } from './AgentAccessModal'

const API = 'http://localhost/api/v1'
const AGENT_ACCESS_URL = `${API}/managed-databases/11/agent-access`

const SERVER_URL = `${API}/servers/1`
const PROVISION_URL = `${API}/servers/1/readonly-credential/provision`
const DAY_MS = 24 * 60 * 60 * 1000

/** Fecha-hora UTC sin zona, como la manda el backend, `days` días atrás. */
function utcDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 19)
}

/** Servidor de la base del fixture (`server_id: 1`); por defecto con credencial verificada. */
function serverWith(overrides: Partial<ServerOut> = {}): ServerOut {
  return {
    id: 1,
    name: 'mysql-prod',
    host: 'db.example.com',
    port: 3306,
    engine: 'mysql',
    root_username: 'gateway_root',
    ssl_mode: 'require',
    status: 'active',
    is_active: true,
    notes: null,
    has_root_password: true,
    has_readonly_credential: true,
    readonly_verified_at: utcDaysAgo(1),
    created_at: '2026-06-23T10:00:00Z',
    updated_at: '2026-06-23T10:00:00Z',
    ...overrides,
  }
}

/**
 * Sesión con `environments.write` (solo la da `security_officer`, que además trae `servers.admin`)
 * o sin ella. `canAdminServers: false` deja `environments.write` pero quita `servers.admin`.
 * También responde el detalle del servidor, que el modal consulta al habilitar.
 */
function mockSession({
  canWrite,
  canAdminServers = true,
  serverOut = serverWith(),
}: {
  canWrite: boolean
  canAdminServers?: boolean
  serverOut?: ServerOut
}) {
  let me = canWrite
    ? meFixture({ global_capabilities: ['security_officer'] })
    : meFixture({ role: 'owner' })
  if (canWrite && !canAdminServers) {
    me = meFixture({
      global_capabilities: ['security_officer'],
      capabilities: me.capabilities.filter((id) => id !== 'servers.admin'),
    })
  }
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(SERVER_URL, () => HttpResponse.json({ data: serverOut })),
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

  describe('credencial de solo lectura del servidor', () => {
    const CHECKBOX = 'Generar también la credencial de solo lectura del servidor 🔌'

    /** Abre el modal con la base cerrada y activa «Permitir agentes». */
    async function openAndAllow() {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(
        <AgentAccessModal database={managedDatabaseFixture()} onClose={onClose} />,
      )
      await user.click(screen.getByRole('switch', { name: 'Permitir agentes' }))
      return { user, onClose }
    }

    function mockGrant(onCall: () => void = () => {}, status = 200) {
      server.use(
        http.put(AGENT_ACCESS_URL, () => {
          onCall()
          if (status !== 200) {
            return HttpResponse.json(
              { detail: { msg: 'Sin permiso.', type: 'AppHttpException' } },
              { status },
            )
          }
          return HttpResponse.json({ data: managedDatabaseFixture({ agent_access_allowed: true }) })
        }),
      )
    }

    it.each([
      [
        'sin credencial',
        serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      ],
      ['sin verificar', serverWith({ readonly_verified_at: null })],
      ['verificación vencida', serverWith({ readonly_verified_at: utcDaysAgo(45) })],
    ])(
      'con la credencial %s y servers.admin ofrece la casilla, marcada por defecto',
      async (_n, serverOut) => {
        mockSession({ canWrite: true, serverOut })
        await openAndAllow()

        const checkbox = await screen.findByRole('checkbox', { name: CHECKBOX })
        expect(checkbox).toBeChecked()
        expect(
          screen.getByRole('button', { name: 'Permitir y generar credencial 🔌' }),
        ).toBeEnabled()
      },
    )

    it('el consentimiento deja claro que la credencial es por servidor', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      await openAndAllow()

      const section = await screen.findByRole('region', {
        name: 'Credencial de solo lectura del servidor',
      })
      expect(within(section).getByText(/por servidor, no por base de datos/)).toBeInTheDocument()
      expect(
        within(section).getByText(/TODAS las bases no internas de este servidor/),
      ).toBeInTheDocument()
      expect(
        within(section).getByText(/no quedan cubiertas hasta que la regeneres/),
      ).toBeInTheDocument()
      expect(within(section).getByText(/cuenta de administrador del servidor/)).toBeInTheDocument()
      expect(within(section).getByText(/nunca se muestra/)).toBeInTheDocument()
    })

    it('con la credencial verificada no muestra nada extra', async () => {
      mockSession({ canWrite: true })
      await openAndAllow()

      // Se espera a que el detalle del servidor haya llegado antes de afirmar la ausencia.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(
        screen.queryByText('Falta la credencial de solo lectura del servidor'),
      ).not.toBeInTheDocument()
    })

    it('sin servers.admin no hay casilla: avisa y enlaza al servidor', async () => {
      mockSession({
        canWrite: true,
        canAdminServers: false,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      await openAndAllow()

      expect(
        await screen.findByText('Falta la credencial de solo lectura del servidor'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'panel del servidor' })).toHaveAttribute(
        'href',
        '/servers/1',
      )
      // El aviso no bloquea: se guarda con el label de siempre.
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
    })

    it('desmarcada, guarda el permiso y NO llama al aprovisionamiento', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      let grants = 0
      let provisions = 0
      mockGrant(() => (grants += 1))
      server.use(
        http.post(PROVISION_URL, () => {
          provisions += 1
          return HttpResponse.json({ data: serverWith() })
        }),
      )
      const { user, onClose } = await openAndAllow()

      await user.click(await screen.findByRole('checkbox', { name: CHECKBOX }))
      await user.click(screen.getByRole('button', { name: 'Guardar' }))

      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(grants).toBe(1)
      expect(provisions).toBe(0)
    })

    it('marcada, genera la credencial solo después de que el permiso se guardó', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      const order: string[] = []
      mockGrant(() => order.push('grant'))
      server.use(
        http.post(PROVISION_URL, () => {
          order.push('provision')
          return HttpResponse.json({ data: serverWith() })
        }),
      )
      const { user, onClose } = await openAndAllow()

      await user.click(
        await screen.findByRole('button', { name: 'Permitir y generar credencial 🔌' }),
      )

      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(order).toEqual(['grant', 'provision'])
    })

    it('si el permiso falla, la credencial nunca se genera', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      let grants = 0
      let provisions = 0
      mockGrant(() => (grants += 1), 500)
      server.use(
        http.post(PROVISION_URL, () => {
          provisions += 1
          return HttpResponse.json({ data: serverWith() })
        }),
      )
      const { user, onClose } = await openAndAllow()

      await user.click(
        await screen.findByRole('button', { name: 'Permitir y generar credencial 🔌' }),
      )

      await waitFor(() => expect(grants).toBeGreaterThanOrEqual(1))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(provisions).toBe(0)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('si la credencial falla tras el permiso, el acceso queda concedido y se explica por qué', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      let grants = 0
      let provisions = 0
      mockGrant(() => (grants += 1))
      server.use(
        http.post(PROVISION_URL, () => {
          provisions += 1
          return HttpResponse.json(
            {
              detail: {
                msg: 'La credencial de solo lectura tiene privilegios de escritura o de más.',
                type: 'AppHttpException',
                public_context: {
                  code: 'server.readonly_probe_failed',
                  violations: ['privilege:insert'],
                },
              },
            },
            { status: 422 },
          )
        }),
      )
      const { user, onClose } = await openAndAllow()

      await user.click(
        await screen.findByRole('button', { name: 'Permitir y generar credencial 🔌' }),
      )

      expect(
        await screen.findByText('El acceso se concedió, pero la credencial no se generó'),
      ).toBeInTheDocument()
      expect(screen.getByText(/Tiene el privilegio INSERT/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'panel del servidor' })).toHaveAttribute(
        'href',
        '/servers/1',
      )
      // Ni se revierte el permiso, ni se reintenta, ni se cierra sobre el aviso.
      expect(grants).toBe(1)
      expect(provisions).toBe(1)
      expect(onClose).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: /Permitir y generar credencial|Guardar/ }),
      ).toBeDisabled()
    })

    it('un 409 de cuenta protegida reutiliza el copy de la credencial', async () => {
      mockSession({
        canWrite: true,
        serverOut: serverWith({ has_readonly_credential: false, readonly_verified_at: null }),
      })
      mockGrant()
      server.use(
        http.post(PROVISION_URL, () =>
          HttpResponse.json(
            {
              detail: {
                msg: 'cuenta protegida',
                type: 'AppHttpException',
                public_context: {
                  code: 'engine_user.protected_account',
                  reason: 'reserved_account',
                },
              },
            },
            { status: 409 },
          ),
        ),
      )
      const { user } = await openAndAllow()

      await user.click(
        await screen.findByRole('button', { name: 'Permitir y generar credencial 🔌' }),
      )

      // El mismo copy sale dos veces a propósito: en el aviso del modal («El acceso se concedió,
      // pero la credencial no se generó») y en el toast de error del propio hook.
      const copies = await screen.findAllByText(/cuenta reservada, la pseudo-root o un rol/)
      expect(copies.length).toBeGreaterThanOrEqual(1)
    })
  })
})
