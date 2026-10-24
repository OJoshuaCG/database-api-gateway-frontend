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
import { RELEASE_CHANNELS_WRITE_UNBLOCK } from '../messages'
import { ReleaseChannelsPanel } from './ReleaseChannelsPanel'

const API = 'http://localhost/api/v1'

function channelFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Estable',
    slug: 'stable',
    resolution_mode: 'manual',
    environment_id: 4,
    pointer_count: 0,
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T10:00:00Z',
    ...overrides,
  }
}

/** Sesión con `release_channels.write` (la da `security_officer`) o sin ella. */
function mockSession({ canWrite }: { canWrite: boolean }) {
  const me = canWrite
    ? meFixture({ global_capabilities: ['security_officer'] })
    : meFixture({ role: 'owner' })
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

function mockCatalog(channels: ReturnType<typeof channelFixture>[]) {
  server.use(
    http.get(`${API}/release-channels`, () => HttpResponse.json(pageOf(channels))),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(pageOf([environmentFixture(4, 'Production', 3)])),
    ),
  )
}

function conflict(status: number, code: string, publicContext: Record<string, unknown> = {}) {
  return HttpResponse.json(
    {
      detail: {
        msg: 'Rechazado.',
        type: 'AppHttpException',
        public_context: { code, ...publicContext },
      },
    },
    { status },
  )
}

/** `DataTable` pinta cada fila dos veces; se actúa sobre la primera y se falla claro si no hay. */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('La consulta no devolvió ningún elemento.')
  return item
}

afterEach(() => {
  setStepUpHandler(null)
})

describe('ReleaseChannelsPanel', () => {
  it('lista los canales con su modo y el nombre del entorno enlazado', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    renderWithProviders(<ReleaseChannelsPanel />)

    // DataTable pinta cada fila dos veces (tabla y tarjetas `< md`): se pide al menos una.
    expect(await screen.findAllByText('Estable')).not.toHaveLength(0)
    expect(screen.getAllByText('stable')).not.toHaveLength(0)
    expect(screen.getAllByText('Manual')).not.toHaveLength(0)
    expect(await screen.findAllByText('Production')).not.toHaveLength(0)
  })

  it('dice quién escribe canales y cómo desbloquearlo', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    renderWithProviders(<ReleaseChannelsPanel />)

    expect(await screen.findByText(RELEASE_CHANNELS_WRITE_UNBLOCK)).toBeVisible()
    expect(RELEASE_CHANNELS_WRITE_UNBLOCK).toContain('Usuarios → Accesos')
  })

  it('sin `release_channels.write` deshabilita crear, editar y borrar, y dice por qué', async () => {
    mockSession({ canWrite: false })
    mockCatalog([channelFixture()])
    renderWithProviders(<ReleaseChannelsPanel />)

    expect(
      await screen.findByText(/crear, editar o borrar canales de liberación/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuevo canal' })).toBeDisabled()
    // Deshabilitados en las dos vistas de DataTable (tabla y tarjetas), no solo en una.
    for (const button of await screen.findAllByRole('button', { name: 'Editar Estable' })) {
      expect(button).toBeDisabled()
    }
    for (const button of screen.getAllByRole('button', { name: 'Borrar Estable' })) {
      expect(button).toBeDisabled()
    }
  })

  it('el alta manda el body del contrato (slug normalizado, sin entorno)', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    let body: unknown = null
    server.use(
      http.post(`${API}/release-channels`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: channelFixture({ id: 2 }) }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(await screen.findByRole('button', { name: 'Nuevo canal' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Candidato')
    await user.type(within(dialog).getByLabelText(/Identificador/), 'Release-Candidate')
    await user.click(within(dialog).getByRole('button', { name: 'Crear canal' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      name: 'Candidato',
      slug: 'release-candidate',
      resolution_mode: 'manual',
      environment_id: null,
    })
  })

  it('un 409 slug_taken se muestra junto al campo identificador', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    server.use(
      http.post(`${API}/release-channels`, () => conflict(409, 'release_channel.slug_taken')),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(await screen.findByRole('button', { name: 'Nuevo canal' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Otro')
    await user.type(within(dialog).getByLabelText(/Identificador/), 'stable')
    await user.click(within(dialog).getByRole('button', { name: 'Crear canal' }))

    expect(
      await within(dialog).findByText('Ya existe un canal con ese identificador.'),
    ).toBeInTheDocument()
  })

  it('la edición deshabilita el slug y no lo manda en el PATCH', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    let body: unknown = null
    server.use(
      http.patch(`${API}/release-channels/1`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: channelFixture({ name: 'Estable v2' }) })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Editar Estable' })))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Identificador/)).toBeDisabled()
    const name = within(dialog).getByLabelText(/Nombre/)
    await user.clear(name)
    await user.type(name, 'Estable v2')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ name: 'Estable v2', resolution_mode: 'manual', environment_id: 4 })
  })

  it('borrar un canal sin punteros no pide slug ni manda confirm_slug', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture({ pointer_count: 0 })])
    let confirmSlug: string | null = 'sin-llamar'
    server.use(
      http.delete(`${API}/release-channels/1`, ({ request }) => {
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        return HttpResponse.json({ data: null, message: 'Canal de liberación borrado.' })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Borrar Estable' })))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar canal' }))

    await waitFor(() => expect(confirmSlug).toBeNull())
  })

  it('borrar un canal con punteros exige reescribir el slug y lo manda como confirm_slug', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture({ pointer_count: 3 })])
    let confirmSlug: string | null = null
    server.use(
      http.delete(`${API}/release-channels/1`, ({ request }) => {
        confirmSlug = new URL(request.url).searchParams.get('confirm_slug')
        return HttpResponse.json({ data: null, message: 'Canal de liberación borrado.' })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Borrar Estable' })))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Borrar canal' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Escribí «stable» para confirmar/), 'stable')
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await waitFor(() => expect(confirmSlug).toBe('stable'))
  })

  it('ante el 403 de step-up pide la contraseña y reenvía el DELETE una sola vez', async () => {
    mockSession({ canWrite: true })
    mockCatalog([channelFixture()])
    let calls = 0
    server.use(
      http.delete(`${API}/release-channels/1`, () => {
        calls += 1
        if (calls === 1) {
          return conflict(403, 'access.step_up_required', { step_up_ttl_seconds: 300 })
        }
        return HttpResponse.json({ data: null, message: 'Canal de liberación borrado.' })
      }),
    )
    let prompts = 0
    setStepUpHandler(() => {
      prompts += 1
      return Promise.resolve(true)
    })
    const user = userEvent.setup()
    renderWithProviders(<ReleaseChannelsPanel />)

    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Borrar Estable' })))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar canal' }))

    await waitFor(() => expect(calls).toBe(2))
    expect(prompts).toBe(1)
  })
})
