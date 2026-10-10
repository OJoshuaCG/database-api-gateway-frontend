import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { pageOf, serverFixture } from '@/test/fixtures/authz-catalog'
import { IntegrationTokenFormModal } from './IntegrationTokenFormModal'

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
  allow_non_expiring: false,
}

const CREATED_TOKEN = {
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
  token: 'datumint.ab12cd34.secreto',
}

function blueprintFixture(id: number, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    current_version: '0001',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function mockBackend(ceiling: Record<string, unknown> = CEILING) {
  const createRequests: unknown[] = []
  server.use(
    http.get(`${API}/integration-tokens/ceiling`, () => HttpResponse.json({ data: ceiling })),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([serverFixture(1, 'prod-mysql')]))),
    http.get(`${API}/database-models`, () =>
      HttpResponse.json(pageOf([blueprintFixture(5, 'Tienda')])),
    ),
    http.post(`${API}/integration-tokens`, async ({ request }) => {
      createRequests.push(await request.json())
      return HttpResponse.json({ data: CREATED_TOKEN }, { status: 201 })
    }),
  )
  return createRequests
}

async function pickFirstServer(user: ReturnType<typeof userEvent.setup>) {
  const [serverToggle] = await screen.findAllByRole('button', { name: 'Abrir lista' })
  await user.click(serverToggle as HTMLElement)
  await user.click(await screen.findByRole('option', { name: 'prod-mysql' }))
}

async function pickFirstBlueprint(user: ReturnType<typeof userEvent.setup>) {
  const toggles = await screen.findAllByRole('button', { name: 'Abrir lista' })
  await user.click(toggles[1] as HTMLElement)
  await user.click(await screen.findByRole('option', { name: 'Tienda' }))
}

function renderForm(onCreated = vi.fn()) {
  renderWithProviders(<IntegrationTokenFormModal open onClose={() => {}} onCreated={onCreated} />)
  return onCreated
}

describe('IntegrationTokenFormModal — qué se ofrece', () => {
  it('ofrece solo los scopes que devuelve el techo, agrupados por tier', async () => {
    mockBackend({ ...CEILING, scopes: [CEILING.scopes[0]] })
    renderForm()

    expect(
      await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Escritura')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Destructivas/ })).not.toBeInTheDocument()
  })

  it('con la API apagada avisa y no deja emitir', async () => {
    mockBackend({ ...CEILING, enabled: false })
    renderForm()

    expect(await screen.findByText(/La API de integración está apagada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
  })
})

describe('IntegrationTokenFormModal — vencimiento por tier', () => {
  it('el tope del campo baja con escritura y con destructivos según lo que informa el servidor', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderForm()

    await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ })
    const ttlInput = screen.getByLabelText(/Vence en/)
    expect(ttlInput).toHaveAttribute('max', '90')
    expect(ttlInput).toHaveValue(90)

    await user.click(screen.getByRole('checkbox', { name: /Crear una base de datos/ }))
    expect(ttlInput).toHaveAttribute('max', '30')
    expect(ttlInput).toHaveValue(30)

    await user.click(screen.getByRole('button', { name: /Destructivas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))
    expect(ttlInput).toHaveAttribute('max', '7')
    expect(ttlInput).toHaveValue(7)
  })

  it('un vencimiento tipeado que supera el nuevo tope marca error y bloquea el envío', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderForm()

    await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ })
    const ttlInput = screen.getByLabelText(/Vence en/)
    await user.clear(ttlInput)
    await user.type(ttlInput, '60')
    await user.click(screen.getByRole('checkbox', { name: /Crear una base de datos/ }))

    expect(await screen.findByText('Fuera de rango')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
  })
})

describe('IntegrationTokenFormModal — sin vencimiento', () => {
  it('no ofrece «Sin vencimiento» si el despliegue no lo permite', async () => {
    mockBackend()
    renderForm()

    await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ })

    expect(screen.queryByRole('checkbox', { name: 'Sin vencimiento' })).not.toBeInTheDocument()
  })

  it('con la opción marcada manda never_expires y no expires_in_days', async () => {
    const createRequests = mockBackend({ ...CEILING, allow_non_expiring: true })
    const user = userEvent.setup()
    const onCreated = renderForm()

    await user.type(await screen.findByLabelText(/Nombre/), 'web-tienda')
    await user.click(await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'Sin vencimiento' }))
    await pickFirstServer(user)
    await user.click(screen.getByRole('button', { name: 'Emitir token' }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(createRequests).toEqual([
      {
        name: 'web-tienda',
        scopes: ['servers.list'],
        server_ids: [1],
        blueprint_ids: [],
        never_expires: true,
      },
    ])
  })

  it('al elegir un permiso destructivo la opción desaparece', async () => {
    mockBackend({ ...CEILING, allow_non_expiring: true })
    const user = userEvent.setup()
    renderForm()

    await user.click(await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }))
    expect(screen.getByRole('checkbox', { name: 'Sin vencimiento' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Destructivas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))

    expect(screen.queryByRole('checkbox', { name: 'Sin vencimiento' })).not.toBeInTheDocument()
  })
})

describe('IntegrationTokenFormModal — emisión', () => {
  it('con solo lectura manda el cuerpo esperado y entrega el bearer al llamador', async () => {
    const createRequests = mockBackend()
    const user = userEvent.setup()
    const onCreated = renderForm()

    await user.type(await screen.findByLabelText(/Nombre/), 'web-tienda')
    await user.click(await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }))
    await pickFirstServer(user)
    await user.click(screen.getByRole('button', { name: 'Emitir token' }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(createRequests).toEqual([
      {
        name: 'web-tienda',
        scopes: ['servers.list'],
        server_ids: [1],
        blueprint_ids: [],
        expires_in_days: 90,
      },
    ])
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ token: 'datumint.ab12cd34.secreto' })
  })

  it('sin servidor elegido no deja emitir', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderForm()

    await user.type(await screen.findByLabelText(/Nombre/), 'web-tienda')
    await user.click(await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }))

    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
  })
})

describe('IntegrationTokenFormModal — scopes destructivos', () => {
  async function fillUntilDestructiveSelected(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText(/Nombre/), 'web-tienda')
    await user.click(await screen.findByRole('button', { name: /Destructivas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))
    await pickFirstServer(user)
  }

  it('exige blueprint y la confirmación explícita antes de habilitar el envío', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderForm()
    await fillUntilDestructiveSelected(user)

    const submit = screen.getByRole('button', { name: 'Emitir token' })
    expect(submit).toBeDisabled()

    await pickFirstBlueprint(user)
    // Con blueprint pero sin aceptar el riesgo sigue bloqueado.
    expect(submit).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    )
    expect(submit).toBeEnabled()
  })

  it('la confirmación sola no alcanza: sin blueprint sigue bloqueado', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderForm()
    await fillUntilDestructiveSelected(user)

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    )
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
    expect(screen.getByText(/Obligatorio con permisos destructivos/)).toBeInTheDocument()
  })

  it('envía blueprint_ids y el vencimiento del tier destructivo', async () => {
    const createRequests = mockBackend()
    const user = userEvent.setup()
    const onCreated = renderForm()
    await fillUntilDestructiveSelected(user)
    await pickFirstBlueprint(user)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Emitir token' }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(createRequests).toEqual([
      {
        name: 'web-tienda',
        scopes: ['migrations.rollback'],
        server_ids: [1],
        blueprint_ids: [5],
        expires_in_days: 7,
      },
    ])
  })
})

describe('IntegrationTokenFormModal — errores del servidor', () => {
  it('muestra el copy del módulo ante un 422 de blueprint obligatorio', async () => {
    mockBackend()
    server.use(
      http.post(`${API}/integration-tokens`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Falta la lista de blueprints.',
              type: 'AppHttpException',
              public_context: { code: 'integration_token.blueprint_allowlist_required' },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(await screen.findByLabelText(/Nombre/), 'web-tienda')
    await user.click(await screen.findByRole('checkbox', { name: /Listar servidores permitidos/ }))
    await pickFirstServer(user)
    await user.click(screen.getByRole('button', { name: 'Emitir token' }))

    // El mismo copy puede aparecer también en el toast del hook, por eso se acepta más de uno.
    const messages = await screen.findAllByText(
      /exigen al menos un blueprint en la lista permitida/,
    )
    expect(messages.length).toBeGreaterThan(0)
  })
})
