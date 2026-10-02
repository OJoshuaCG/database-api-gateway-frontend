import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  CATALOG_FIXTURE,
  environmentFixture,
  meFixture,
  pageOf,
} from '@/test/fixtures/authz-catalog'
import { ENVIRONMENTS_WRITE_UNBLOCK } from '@/features/environments'
import { ManagedDatabaseForm } from './ManagedDatabaseForm'

const API = 'http://localhost/api/v1'

function mockSession(globals: string[]) {
  server.use(
    http.get(`${API}/auth/me`, () =>
      HttpResponse.json({ data: meFixture({ role: 'owner', global_capabilities: globals }) }),
    ),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
    http.get(`${API}/servers`, () => HttpResponse.json(pageOf([]))),
    http.get(`${API}/database-models`, () => HttpResponse.json(pageOf([]))),
  )
}

function renderEdit() {
  renderWithProviders(
    <ManagedDatabaseForm
      mode="edit"
      defaultValues={{ environment_id: 1 }}
      readonlyIdentity={{ name: 'tienda' }}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  )
}

describe('ManagedDatabaseForm: reclasificar', () => {
  it('sin environments.write el selector de entorno va deshabilitado y explica cómo desbloquearlo', async () => {
    mockSession([])
    renderEdit()
    expect(await screen.findByText(ENVIRONMENTS_WRITE_UNBLOCK)).toBeVisible()
    expect(screen.getByRole('combobox', { name: /entorno/i })).toBeDisabled()
  })

  it('con security_officer el selector queda habilitado', async () => {
    mockSession(['security_officer'])
    renderEdit()
    const combo = await screen.findByRole('combobox', { name: /entorno/i })
    expect(combo).toBeEnabled()
    expect(screen.queryByText(ENVIRONMENTS_WRITE_UNBLOCK)).not.toBeInTheDocument()
  })
})
