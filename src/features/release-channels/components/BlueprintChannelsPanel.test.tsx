import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture, pageOf } from '@/test/fixtures/authz-catalog'
import { setStepUpHandler } from '@/lib/api/client'
import { BlueprintChannelsPanel } from './BlueprintChannelsPanel'

const API = 'http://localhost/api/v1'
const MODEL_ID = 3
const CHANNELS_URL = `${API}/database-models/${MODEL_ID}/channels`

const VERSIONS = [
  { version: '0001', reviewed: true },
  { version: '0002', reviewed: true },
  { version: '0003', reviewed: true },
  { version: '0004', reviewed: false },
]

function resolutionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    channel_slug: 'stable',
    channel_name: 'Estable',
    resolution_mode: 'manual',
    environment_slug: 'production',
    resolved: true,
    code: null,
    version: '0002',
    model_migration_id: 12,
    source: 'pointer',
    databases: [],
    derived_reference: {
      environment_slug: 'production',
      resolved: true,
      code: null,
      version: '0001',
      model_migration_id: 11,
      source: 'inventory_cache',
      databases: [],
    },
    ...overrides,
  }
}

/** `owner` tiene `blueprints.promote`; `viewer` no. */
function mockSession(role: 'owner' | 'viewer') {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

function mockChannels(channels: ReturnType<typeof resolutionFixture>[]) {
  server.use(http.get(CHANNELS_URL, () => HttpResponse.json({ data: channels })))
}

function mount() {
  return renderWithProviders(<BlueprintChannelsPanel modelId={MODEL_ID} versions={VERSIONS} />)
}

async function chooseVersion(user: ReturnType<typeof userEvent.setup>, version: string) {
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('combobox', { name: /Versión destino/ }))
  await user.click(await screen.findByRole('option', { name: version }))
  return dialog
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('BlueprintChannelsPanel', () => {
  it('muestra la versión servida, su origen y el mínimo del entorno como referencia', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture()])
    mount()

    expect(await screen.findByText('Estable')).toBeInTheDocument()
    expect(screen.getByText('0002')).toBeInTheDocument()
    expect(screen.getByText('Puntero manual')).toBeInTheDocument()
    expect(screen.getByText(/Referencia/)).toBeInTheDocument()
    expect(screen.getByText('0001')).toBeInTheDocument()
  })

  it('un canal sin resolver muestra el motivo en vez de una versión', async () => {
    mockSession('owner')
    mockChannels([
      resolutionFixture({
        resolved: false,
        version: null,
        code: 'release_channel.no_released_version',
        derived_reference: null,
        environment_slug: null,
      }),
    ])
    mount()

    expect(await screen.findByText('sin versión')).toBeInTheDocument()
    expect(
      screen.getByText('El canal todavía no tiene ninguna versión liberada para este blueprint.'),
    ).toBeInTheDocument()
  })

  it('sin `blueprints.promote` deshabilita «Promover…»', async () => {
    mockSession('viewer')
    mockChannels([resolutionFixture()])
    mount()

    expect(await screen.findByRole('button', { name: 'Promover…' })).toBeDisabled()
  })

  it('un canal derivado no ofrece promover', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture({ resolution_mode: 'derived', source: 'inventory_cache' })])
    mount()

    await screen.findByText('Estable')
    expect(screen.queryByRole('button', { name: 'Promover…' })).not.toBeInTheDocument()
  })

  it('promover hacia adelante manda la versión sin `confirm_slug`', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture()])
    let body: unknown = null
    let confirmSlug: string | null = 'sin-llamar'
    server.use(
      http.post(`${CHANNELS_URL}/stable/promote`, async ({ request }) => {
        body = await request.json()
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        return HttpResponse.json({
          data: {
            channel_slug: 'stable',
            changed: true,
            event_type: 'promote',
            from_version: '0002',
            to_version: '0003',
            model_migration_id: 13,
          },
        })
      }),
    )
    const user = userEvent.setup()
    mount()

    await user.click(await screen.findByRole('button', { name: 'Promover…' }))
    const dialog = await chooseVersion(user, '0003')
    await user.click(within(dialog).getByRole('button', { name: 'Promover' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ version: '0003' })
    expect(confirmSlug).toBeNull()
  })

  it('las versiones sin revisar no se ofrecen como destino', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture()])
    const user = userEvent.setup()
    mount()

    await user.click(await screen.findByRole('button', { name: 'Promover…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: /Versión destino/ }))

    expect(await screen.findByRole('option', { name: '0003' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '0004' })).not.toBeInTheDocument()
  })

  it('retroceder exige reescribir el slug y lo manda como `confirm_slug`', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture({ version: '0003' })])
    let confirmSlug: string | null = null
    server.use(
      http.post(`${CHANNELS_URL}/stable/promote`, ({ request }) => {
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        return HttpResponse.json({
          data: {
            channel_slug: 'stable',
            changed: true,
            event_type: 'demote',
            from_version: '0003',
            to_version: '0001',
            model_migration_id: 11,
          },
        })
      }),
    )
    const user = userEvent.setup()
    mount()

    await user.click(await screen.findByRole('button', { name: 'Promover…' }))
    const dialog = await chooseVersion(user, '0001')
    const confirm = within(dialog).getByRole('button', { name: 'Retroceder el canal' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Escribí «stable» para confirmar/), 'stable')
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await waitFor(() => expect(confirmSlug).toBe('stable'))
  })

  it('el historial lista los eventos del puntero', async () => {
    mockSession('owner')
    mockChannels([resolutionFixture()])
    server.use(
      http.get(`${CHANNELS_URL}/stable/history`, () =>
        HttpResponse.json(
          pageOf([
            {
              id: 1,
              event_type: 'promote',
              from_version: '0001',
              to_version: '0002',
              note: 'listo para producción',
              actor_username: 'admin',
              actor_type: 'admin',
              created_at: '2026-10-24T10:00:00Z',
            },
          ]),
        ),
      ),
    )
    const user = userEvent.setup()
    mount()

    await user.click(await screen.findByRole('button', { name: 'Historial' }))

    expect(await screen.findByText('Promovido')).toBeInTheDocument()
    expect(screen.getByText(/listo para producción/)).toBeInTheDocument()
  })
})
