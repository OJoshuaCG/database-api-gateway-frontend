import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { pageOf, serverFixture } from '@/test/fixtures/authz-catalog'
import { BlueprintAllowlistPicker } from './BlueprintAllowlistPicker'
import { ServerAllowlistPicker } from './ServerAllowlistPicker'

const API = 'http://localhost/api/v1'

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

describe('ServerAllowlistPicker', () => {
  it('muestra como elegidos los servidores cuyo id está en la lista', async () => {
    server.use(
      http.get(`${API}/servers`, () =>
        HttpResponse.json(pageOf([serverFixture(1, 'prod-mysql'), serverFixture(2, 'stg-mysql')])),
      ),
    )
    renderWithProviders(<ServerAllowlistPicker value={[2]} onChange={() => {}} />)

    expect(await screen.findByText('stg-mysql')).toBeInTheDocument()
    expect(screen.queryByText('prod-mysql')).not.toBeInTheDocument()
    expect(screen.getByText(/Obligatorio/)).toBeInTheDocument()
  })

  it('quitar un servidor devuelve la lista de ids sin él', async () => {
    server.use(
      http.get(`${API}/servers`, () =>
        HttpResponse.json(pageOf([serverFixture(1, 'prod-mysql'), serverFixture(2, 'stg-mysql')])),
      ),
    )
    const user = userEvent.setup()
    const received: number[][] = []
    renderWithProviders(
      <ServerAllowlistPicker value={[1, 2]} onChange={(next) => received.push(next)} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Quitar prod-mysql' }))
    expect(received.at(-1)).toEqual([2])
  })
})

describe('BlueprintAllowlistPicker', () => {
  it('explica que vacío significa sin restricción cuando no es obligatorio', async () => {
    server.use(
      http.get(`${API}/database-models`, () =>
        HttpResponse.json(pageOf([blueprintFixture(5, 'Tienda')])),
      ),
    )
    renderWithProviders(
      <BlueprintAllowlistPicker value={[]} required={false} onChange={() => {}} />,
    )

    expect(await screen.findByText(/sin restricción de blueprint/i)).toBeInTheDocument()
    expect(screen.queryByText(/Obligatorio/)).not.toBeInTheDocument()
  })

  it('con scopes destructivos lo marca obligatorio', async () => {
    server.use(
      http.get(`${API}/database-models`, () =>
        HttpResponse.json(pageOf([blueprintFixture(5, 'Tienda')])),
      ),
    )
    renderWithProviders(<BlueprintAllowlistPicker value={[5]} required onChange={() => {}} />)

    expect(await screen.findByText('Tienda')).toBeInTheDocument()
    expect(screen.getByText(/Obligatorio con permisos destructivos/)).toBeInTheDocument()
  })
})
