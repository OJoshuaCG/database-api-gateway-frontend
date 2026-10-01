import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Button } from '@/components/ui'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import {
  CATALOG_FIXTURE,
  environmentFixture,
  meFixture,
  pageOf,
} from '@/test/fixtures/authz-catalog'
import { CAPABILITIES } from '@/lib/contracts'
import type { AccessTarget } from '../authz-model'
import { CapabilityHint } from '../components/CapabilityHint'
import { useCapabilities } from './use-capabilities'
import { useCapabilityGuard } from './use-capability-guard'

const API = 'http://localhost/api/v1'

function mockSession(me: Record<string, unknown>) {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
    http.get(`${API}/environments`, () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
  )
}

/** El patrón de una acción única en contexto: deshabilitada y con el motivo visible al lado. */
function ApplyButton({ scope }: { scope?: AccessTarget }) {
  const guard = useCapabilityGuard(CAPABILITIES.blueprintsApply, 'aplicar versiones', { scope })
  const { known } = useCapabilities()
  return (
    <div>
      {/* Marca de «la sesión ya llegó»: antes de eso la guarda falla abierto por diseño. */}
      {known && <span>sesión cargada</span>}
      <Button disabled={!guard.allowed} aria-describedby={guard.describedBy}>
        Aplicar
      </Button>
      <CapabilityHint guard={guard} />
    </div>
  )
}

describe('useCapabilityGuard', () => {
  it('un operator ve «Aplicar» deshabilitado con el motivo, que nombra la capacidad', async () => {
    mockSession(meFixture({ role: 'operator' }))
    renderWithProviders(<ApplyButton />)
    // El catálogo llega después de la sesión: hasta entonces el motivo solo trae el id.
    const hint = await screen.findByText(/«Aplicar y revertir versiones sobre bases reales»/)
    // El label sale del catálogo, y el id va al lado: es lo que se le pide a quien administra.
    expect(hint).toHaveTextContent(
      '«Aplicar y revertir versiones sobre bases reales», blueprints.apply',
    )
    const button = screen.getByRole('button', { name: 'Aplicar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(hint.textContent ?? '')
  })

  it('un owner lo tiene habilitado y sin motivo', async () => {
    mockSession(meFixture({ role: 'owner' }))
    renderWithProviders(<ApplyButton />)
    await screen.findByText('sesión cargada')
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled()
    expect(screen.queryByText(/Tu acceso no permite/)).not.toBeInTheDocument()
  })

  it('con destino resuelve el rol por alcance: owner base con lector en producción', async () => {
    mockSession(
      meFixture({
        role: 'owner',
        base_role: 'owner',
        scope_roles: [{ scope_type: 'environment', scope_id: 3, role: 'viewer' }],
      }),
    )
    renderWithProviders(
      <>
        <ApplyButton scope={{ serverId: 9, environmentId: 3 }} />
        <ApplyButton scope={{ serverId: 9, environmentId: 1 }} />
      </>,
    )
    expect(await screen.findByText(/Tu acceso no permite aplicar versiones/)).toBeInTheDocument()
    const [prod, dev] = screen.getAllByRole('button', { name: 'Aplicar' })
    expect(prod).toBeDisabled()
    expect(dev).toBeEnabled()
  })

  it('con un backend viejo (sin capacidades ni catálogo) falla abierto', async () => {
    mockSession({ id: 1, username: 'admin' })
    const { findByRole, queryByText } = renderWithProviders(<ApplyButton />)
    expect(await findByRole('button', { name: 'Aplicar' })).toBeEnabled()
    // Sin `catalog_version` ni lista no hay pista: «no sé», no «no tiene».
    expect(queryByText('sesión cargada')).not.toBeInTheDocument()
  })
})
