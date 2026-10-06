import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import type { ServerOut } from '@/lib/contracts'
import { ReadonlyCredentialPanel } from './ReadonlyCredentialPanel'

const API = 'http://localhost/api/v1'
const DAY_MS = 24 * 60 * 60 * 1000

/** Fecha-hora UTC sin zona, como la manda el backend, `days` días atrás. */
function utcDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 19)
}

function serverWith(overrides: Partial<ServerOut> = {}): ServerOut {
  return {
    id: 42,
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
    has_readonly_credential: false,
    readonly_verified_at: null,
    created_at: '2026-06-23T10:00:00Z',
    updated_at: '2026-06-23T10:00:00Z',
    ...overrides,
  }
}

/** Sesión con `servers.admin` (la da `security_officer`) o sin ella. */
function mockSession({ canAdmin }: { canAdmin: boolean }) {
  const me = canAdmin
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

describe('ReadonlyCredentialPanel — estados', () => {
  it('sin credencial ofrece cargarla y no ofrece verificar ni quitar', () => {
    mockSession({ canAdmin: true })
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    expect(screen.getByText('Sin credencial')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar credencial' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verificar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument()
  })

  it('con credencial sin verificar avisa que el MCP no la usa', () => {
    mockSession({ canAdmin: true })
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ has_readonly_credential: true })} />,
    )

    expect(screen.getByText('Sin verificar')).toBeInTheDocument()
    expect(screen.getByText(/el MCP no la usa/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reemplazar credencial' })).toBeInTheDocument()
  })

  it('verificada hace poco se muestra como verificada', () => {
    mockSession({ canAdmin: true })
    renderWithProviders(
      <ReadonlyCredentialPanel
        server={serverWith({ has_readonly_credential: true, readonly_verified_at: utcDaysAgo(2) })}
      />,
    )

    expect(screen.getByText('Verificada')).toBeInTheDocument()
  })

  it('verificada hace más de 30 días se muestra vencida', () => {
    mockSession({ canAdmin: true })
    renderWithProviders(
      <ReadonlyCredentialPanel
        server={serverWith({ has_readonly_credential: true, readonly_verified_at: utcDaysAgo(40) })}
      />,
    )

    expect(screen.getByText('Verificación vencida')).toBeInTheDocument()
    expect(screen.getByText(/El MCP la rechaza/)).toBeInTheDocument()
  })
})

describe('ReadonlyCredentialPanel — acciones', () => {
  it('la sonda fallida lista los grants de más para el DBA', async () => {
    mockSession({ canAdmin: true })
    server.use(
      http.post(`${API}/servers/42/test-connection`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('credential')).toBe('readonly')
        return HttpResponse.json(
          {
            detail: {
              msg: 'La credencial de solo lectura tiene privilegios de escritura o de más.',
              type: 'AppHttpException',
              public_context: {
                code: 'server.readonly_probe_failed',
                violations: ['privilege:insert', 'grant_option'],
              },
            },
          },
          { status: 422 },
        )
      }),
      http.get(`${API}/servers/42`, () =>
        HttpResponse.json({ data: serverWith({ has_readonly_credential: true }) }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ has_readonly_credential: true })} />,
    )

    await user.click(screen.getByRole('button', { name: /Verificar/ }))

    const callout = await screen.findByText('La credencial no es de solo lectura')
    const box = callout.closest('div') ?? document.body
    expect(within(box).getByText(/Tiene el privilegio INSERT/)).toBeInTheDocument()
    expect(within(box).getByText('privilege:insert')).toBeInTheDocument()
    expect(within(box).getByText(/GRANT OPTION/)).toBeInTheDocument()
  })

  it('el alta manda exactamente usuario y contraseña, y cierra el formulario', async () => {
    mockSession({ canAdmin: true })
    let received: unknown = null
    server.use(
      http.put(`${API}/servers/42/readonly-credential`, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          data: serverWith({ has_readonly_credential: true, readonly_verified_at: null }),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Cargar credencial' }))
    await user.type(screen.getByLabelText(/Usuario/), 'mcp_ro')
    await user.type(screen.getByLabelText(/Contraseña/), 's3creta')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(received).toEqual({ username: 'mcp_ro', password: 's3creta' }))
    await waitFor(() => expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('s3creta')).not.toBeInTheDocument()
  })

  it('ante el 403 de step-up pide la contraseña y reenvía el alta una sola vez', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.put(`${API}/servers/42/readonly-credential`, () => {
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
        return HttpResponse.json({ data: serverWith({ has_readonly_credential: true }) })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Cargar credencial' }))
    await user.type(screen.getByLabelText(/Usuario/), 'mcp_ro')
    await user.type(screen.getByLabelText(/Contraseña/), 's3creta')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
    await waitFor(() => expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument())
  })

  it('quitarla pide confirmación antes del DELETE', async () => {
    mockSession({ canAdmin: true })
    let deleted = false
    server.use(
      http.delete(`${API}/servers/42/readonly-credential`, () => {
        deleted = true
        return HttpResponse.json({ data: serverWith() })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ has_readonly_credential: true })} />,
    )

    await user.click(screen.getByRole('button', { name: 'Quitar' }))
    expect(deleted).toBe(false)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }))

    await waitFor(() => expect(deleted).toBe(true))
  })
})

describe('ReadonlyCredentialPanel — generación automática', () => {
  const PROVISION = `${API}/servers/42/readonly-credential/provision`

  it('ofrece generar en missing, unverified y stale, y regenerar si está verificada', () => {
    mockSession({ canAdmin: true })
    const cases: Array<[Partial<ServerOut>, string]> = [
      [{}, 'Generar credencial automáticamente 🔌'],
      [{ has_readonly_credential: true }, 'Regenerar credencial 🔌'],
      [
        { has_readonly_credential: true, readonly_verified_at: utcDaysAgo(40) },
        'Regenerar credencial 🔌',
      ],
      [
        { has_readonly_credential: true, readonly_verified_at: utcDaysAgo(2) },
        'Regenerar credencial 🔌',
      ],
    ]
    for (const [overrides, label] of cases) {
      const { unmount } = renderWithProviders(
        <ReadonlyCredentialPanel server={serverWith(overrides)} />,
      )
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      // El alta manual sigue disponible como alternativa.
      expect(
        screen.getByRole('button', { name: /Cargar credencial|Reemplazar credencial/ }),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('confirma antes de llamar y advierte que la credencial es por servidor', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.post(PROVISION, () => {
        calls += 1
        return HttpResponse.json({
          data: serverWith({
            has_readonly_credential: true,
            readonly_verified_at: utcDaysAgo(0),
          }),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Generar credencial automáticamente 🔌' }))

    const dialog = await screen.findByRole('dialog')
    expect(calls).toBe(0)
    expect(
      within(dialog).getByText(/TODAS las bases no internas de este servidor/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/no quedan cubiertas hasta que la regeneres/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/nunca se muestra/)).toBeInTheDocument()
    expect(within(dialog).getByText(/db\.example\.com:3306/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Generar 🔌' }))
    await waitFor(() => expect(calls).toBe(1))
  })

  it('cancelar el diálogo no llama al backend', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.post(PROVISION, () => {
        calls += 1
        return HttpResponse.json({ data: serverWith() })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Generar credencial automáticamente 🔌' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toBe(0)
  })

  it('un 422 de la sonda lista los grants de más', async () => {
    mockSession({ canAdmin: true })
    server.use(
      http.post(PROVISION, () =>
        HttpResponse.json(
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
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Generar credencial automáticamente 🔌' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Generar 🔌' }))

    expect(await screen.findByText('La credencial no es de solo lectura')).toBeInTheDocument()
    expect(screen.getByText(/Tiene el privilegio INSERT/)).toBeInTheDocument()
  })

  it('un 409 de cuenta protegida muestra copy claro y no reintenta', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.post(PROVISION, () => {
        calls += 1
        return HttpResponse.json(
          {
            detail: {
              msg: 'cuenta protegida',
              type: 'AppHttpException',
              public_context: { code: 'engine_user.protected_account', reason: 'reserved_account' },
            },
          },
          { status: 409 },
        )
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: 'Generar credencial automáticamente 🔌' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Generar 🔌' }))

    expect(await screen.findByText(/cuenta reservada, la pseudo-root o un rol/)).toBeInTheDocument()
    expect(calls).toBe(1)
  })
})

describe('ReadonlyCredentialPanel — acceso', () => {
  it('sin `servers.admin` deshabilita las acciones y dice por qué', async () => {
    mockSession({ canAdmin: false })
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ has_readonly_credential: true })} />,
    )

    expect(
      await screen.findByText(/administrar la credencial de solo lectura del MCP/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reemplazar credencial' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Verificar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Regenerar credencial 🔌' })).toBeDisabled()
  })
})

describe('ReadonlyCredentialPanel — lectura de cuerpos de rutinas (mysql.proc)', () => {
  const ROUTINE_BODIES = `${API}/servers/42/readonly-credential/routine-bodies`
  const ACK_TEXT =
    'Entiendo que SELECT ON mysql.proc es server-wide: expone el código de las rutinas de TODAS las bases de datos de este servidor, incluidas las que están fuera del proyecto o excluidas, y que solo el filtrado del gateway lo contiene.'

  it('muestra el estado de la bandera y ofrece el control en MySQL y MariaDB', () => {
    mockSession({ canAdmin: true })
    const { unmount } = renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)
    expect(screen.getByText('Lectura de cuerpos de rutinas')).toBeInTheDocument()
    expect(screen.getByText('Deshabilitada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ })).toBeEnabled()
    unmount()

    renderWithProviders(
      <ReadonlyCredentialPanel
        server={serverWith({ engine: 'mariadb', readonly_proc_grant: true })}
      />,
    )
    expect(screen.getByText('Habilitada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deshabilitar lectura de cuerpos/ })).toBeEnabled()
  })

  it('PostgreSQL con la bandera apagada no muestra el control', () => {
    mockSession({ canAdmin: true })
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith({ engine: 'postgresql' })} />)

    expect(screen.queryByText('Lectura de cuerpos de rutinas')).not.toBeInTheDocument()
  })

  it('sin `servers.admin` el control queda deshabilitado', async () => {
    mockSession({ canAdmin: false })
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    expect(
      await screen.findByText(/administrar la credencial de solo lectura del MCP/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ })).toBeDisabled()
  })

  it('habilitar advierte que es server-wide y exige aceptar el aviso antes de llamar', async () => {
    mockSession({ canAdmin: true })
    let received: unknown = null
    server.use(
      http.put(ROUTINE_BODIES, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          data: {
            server: serverWith({ readonly_proc_grant: true }),
            engine_grant: 'converged',
          },
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Este permiso es de TODO el servidor')).toBeInTheDocument()
    expect(within(dialog).getByText(/TODAS las bases de este servidor/)).toBeInTheDocument()
    expect(within(dialog).getByText(ACK_TEXT)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Habilitar 🔌' })
    expect(confirm).toBeDisabled()

    await user.click(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(received).toEqual({ enabled: true, acknowledgement: ACK_TEXT }))
  })

  it('cancelar no llama al backend y la casilla vuelve desmarcada al reabrir', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.put(ROUTINE_BODIES, () => {
        calls += 1
        return HttpResponse.json({ data: { server: serverWith(), engine_grant: 'converged' } })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))
    let dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ })).not.toBeChecked()
    expect(calls).toBe(0)
  })

  it('deshabilitar no pide el aviso y manda solo `enabled: false`', async () => {
    mockSession({ canAdmin: true })
    let received: unknown = null
    server.use(
      http.put(ROUTINE_BODIES, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ data: { server: serverWith(), engine_grant: 'converged' } })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ readonly_proc_grant: true })} />,
    )

    await user.click(screen.getByRole('button', { name: /Deshabilitar lectura de cuerpos/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Deshabilitar 🔌' }))

    await waitFor(() => expect(received).toEqual({ enabled: false }))
  })

  it('not_alterable muestra un aviso persistente de que faltan los grants del motor', async () => {
    mockSession({ canAdmin: true })
    server.use(
      http.put(ROUTINE_BODIES, () =>
        HttpResponse.json({
          data: {
            server: serverWith({ has_readonly_credential: true, readonly_proc_grant: true }),
            engine_grant: 'not_alterable',
          },
        }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <ReadonlyCredentialPanel server={serverWith({ has_readonly_credential: true })} />,
    )

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Habilitar 🔌' }))

    expect(await screen.findByText('Falta ajustar los grants en el motor')).toBeInTheDocument()
    expect(screen.getByText(/agregale SELECT ON mysql\.proc en el motor/)).toBeInTheDocument()
  })

  it('un 422 engine_unsupported muestra un mensaje claro', async () => {
    mockSession({ canAdmin: true })
    server.use(
      http.put(ROUTINE_BODIES, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'no necesita',
              type: 'AppHttpException',
              public_context: { code: 'server.readonly_proc_grant.engine_unsupported' },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Habilitar 🔌' }))

    expect(
      await screen.findByText(/no necesita ni admite SELECT ON mysql\.proc/),
    ).toBeInTheDocument()
  })

  it('ante el 403 de step-up pide la contraseña y reenvía una sola vez', async () => {
    mockSession({ canAdmin: true })
    let calls = 0
    server.use(
      http.put(ROUTINE_BODIES, () => {
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
        return HttpResponse.json({
          data: {
            server: serverWith({ readonly_proc_grant: true }),
            engine_grant: 'no_credential',
          },
        })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    const user = userEvent.setup()
    renderWithProviders(<ReadonlyCredentialPanel server={serverWith()} />)

    await user.click(screen.getByRole('button', { name: /Habilitar lectura de cuerpos/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Leí el aviso/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Habilitar 🔌' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
  })
})
