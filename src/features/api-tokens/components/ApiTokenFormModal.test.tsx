import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture, pageOf } from '@/test/fixtures/authz-catalog'
import { ApiTokenFormModal } from './ApiTokenFormModal'

const API = 'http://localhost/api/v1'

/** Los siete del techo de agente que publica el backend (api-reference-v30). */
const AGENT_SCOPES = [
  'blueprints.read',
  'catalogs.read',
  'clones.read',
  'databases.read',
  'environments.read',
  'exports.read',
  'schema_diff.read',
]

function mockBackend() {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture() })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/projects`, () => HttpResponse.json(pageOf([]))),
  )
}

describe('ApiTokenFormModal — scopes de agente', () => {
  it('ofrece de entrada los scopes `agent_allowed` del catálogo, sin esperar al 422', async () => {
    mockBackend()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    const title = await screen.findByText('Permisos disponibles para agentes')
    const box = title.closest('div') ?? document.body
    const offered = within(box)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .sort()
    expect(offered).toEqual(AGENT_SCOPES)
  })

  it('tocar un scope lo agrega como chip y deja de ofrecerlo', async () => {
    mockBackend()
    const user = userEvent.setup()
    renderWithProviders(<ApiTokenFormModal open onClose={() => {}} onCreated={() => {}} />)

    const chip = await screen.findByRole('button', { name: 'catalogs.read' })
    await user.click(chip)

    expect(screen.getByRole('button', { name: 'Quitar catalogs.read' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'catalogs.read' })).toBeDisabled()
  })
})
