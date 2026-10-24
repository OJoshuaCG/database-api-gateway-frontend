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
import { ManagedDatabaseForm, toManagedDatabaseCreate } from './ManagedDatabaseForm'

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

describe('toManagedDatabaseCreate: canal y versión son excluyentes', () => {
  const base = {
    name: 'appdb',
    server_id: 1,
    owner_id: 2,
    model_id: 3,
    initialState: 'vacia' as const,
    targetVersion: '0007',
    channelSlug: 'stable',
    environment_id: 4,
    charsetCollation: undefined,
    notes: '',
  }

  it('con «canal» manda el canal y NO la versión, aunque haya una escrita', () => {
    const body = toManagedDatabaseCreate({ ...base, initialState: 'canal' })
    expect(body.channel).toBe('stable')
    expect(body.target_version).toBeNull()
    expect(body.apply_migrations).toBe(true)
  })

  it('con «versión» manda la versión y NO el canal, aunque haya uno elegido', () => {
    const body = toManagedDatabaseCreate({ ...base, initialState: 'version' })
    expect(body.target_version).toBe('0007')
    expect('channel' in body).toBe(false)
  })

  it('con «última» o «vacía» no manda ninguno de los dos', () => {
    for (const initialState of ['ultima', 'vacia'] as const) {
      const body = toManagedDatabaseCreate({ ...base, initialState })
      expect(body.target_version).toBeNull()
      expect('channel' in body).toBe(false)
    }
  })

  it('sin blueprint no manda canal', () => {
    const body = toManagedDatabaseCreate({ ...base, model_id: null, initialState: 'canal' })
    expect('channel' in body).toBe(false)
    expect(body.apply_migrations).toBe(false)
  })
})
