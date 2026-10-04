import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture, pageOf } from '@/test/fixtures/authz-catalog'
import type { ApiTokenOut } from '@/lib/contracts'
import { ApiTokenFormModal } from './ApiTokenFormModal'
import { EditApiTokenScopesModal } from './EditApiTokenScopesModal'

const API = 'http://localhost/api/v1'
const DAY_MS = 24 * 60 * 60 * 1000

function dataRow(id: 'data.read' | 'data.query') {
  return {
    id,
    module: 'data',
    level: id === 'data.read' ? 'read' : 'query',
    label: id === 'data.read' ? 'Leer filas mediante tools' : 'Ejecutar SELECT de un agente',
    mutates: false,
    discloses: true,
    requires_step_up: true,
    agent_allowed: true,
    scope_axis: 'environment' as const,
    roles: ['owner'],
    global_capabilities: [],
  }
}

/** El catálogo del fixture MÁS las dos filas de datos, como las publica el backend nuevo. */
function mockBackend() {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({ data: meFixture({ global_capabilities: ['access_admin'] }) }),
    ),
    http.get(`${API}/authz/catalog`, () =>
      HttpResponse.json({
        data: [...CATALOG_FIXTURE, dataRow('data.read'), dataRow('data.query')],
      }),
    ),
    http.get(`${API}/projects`, () => HttpResponse.json(pageOf([]))),
  )
}

function tokenExpiringIn(days: number, scopes: string[]): ApiTokenOut {
  return {
    id: 12,
    token_id: 'k3f9qm2x',
    name: 'ci-tienda-retail',
    scopes,
    project_id: 4,
    expires_at: new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 19),
    last_used_at: null,
    revoked_at: null,
    note: null,
    active: true,
    created_at: '2026-09-09T12:00:00Z',
  }
}

describe('ApiTokenFormModal — scopes de datos', () => {
  it('ofrece data.read y data.query con una nota, y el aviso recién aparece al añadirlos', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    expect(await screen.findByRole('button', { name: 'data.read' })).toBeEnabled()
    expect(screen.getByText(/leen filas de bases de terceros/)).toBeInTheDocument()
    expect(screen.queryByText('Estos permisos leen datos de terceros')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'data.read' }))

    expect(await screen.findByText('Estos permisos leen datos de terceros')).toBeInTheDocument()
    expect(screen.getByText(/Al guardar se te pide la contraseña/)).toBeInTheDocument()
    expect(screen.getByText(/como máximo 30 días/)).toBeInTheDocument()
    expect(screen.getByText(/lectura de datos apagada/)).toBeInTheDocument()
  })

  it('con un scope de datos el vencimiento por defecto (90) queda fuera de rango', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'data.read' }))

    expect(screen.getByText('Fuera de rango')).toBeInTheDocument()
    const ttl = screen.getByLabelText(/Vence en/)
    expect(ttl).toHaveAttribute('max', '30')
    expect(screen.getByRole('button', { name: 'Emitir token' })).toBeDisabled()
  })

  it('con 30 días el campo es válido y el hint explica por qué el máximo es menor', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'data.read' }))
    const ttl = screen.getByLabelText(/Vence en/)
    await user.clear(ttl)
    await user.type(ttl, '30')

    expect(screen.queryByText('Fuera de rango')).not.toBeInTheDocument()
    expect(screen.getByText(/con permisos de datos el máximo es menor/)).toBeInTheDocument()
  })

  it('quitar el scope de datos devuelve el tope general', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'data.read' }))
    await user.click(screen.getByRole('button', { name: 'Quitar data.read' }))

    expect(screen.getByLabelText(/Vence en/)).toHaveAttribute('max', '90')
    expect(screen.queryByText('Fuera de rango')).not.toBeInTheDocument()
  })
})

describe('EditApiTokenScopesModal — scopes de datos', () => {
  it('agregar datos a un token que vive más de 30 días se avisa y bloquea «Guardar»', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(
      <EditApiTokenScopesModal
        open
        token={tokenExpiringIn(60, ['blueprints.read'])}
        onClose={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'data.read' }))

    expect(await screen.findByText('Este token vive demasiado para leer datos')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled()
  })

  it('con vida restante dentro del tope deja guardar los datos', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(
      <EditApiTokenScopesModal
        open
        token={tokenExpiringIn(10, ['blueprints.read'])}
        onClose={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'data.read' }))

    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeEnabled()
    expect(screen.queryByText('Este token vive demasiado para leer datos')).not.toBeInTheDocument()
  })

  it('un token largo se sigue editando sin datos', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(
      <EditApiTokenScopesModal
        open
        token={tokenExpiringIn(80, ['blueprints.read'])}
        onClose={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'catalogs.read' }))

    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeEnabled()
  })
})
