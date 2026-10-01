import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { CapabilityCallout } from './CapabilityCallout'

const API = 'http://localhost/api/v1'

function mockCatalog() {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role: 'viewer' }) })),
    http.get(`${API}/authz/catalog`, () => HttpResponse.json({ data: CATALOG_FIXTURE })),
  )
}

describe('CapabilityCallout', () => {
  it('dice qué se puede, qué no y qué falta, con la etiqueta del catálogo', async () => {
    mockCatalog()
    renderWithProviders(
      <CapabilityCallout
        id="aviso"
        canDo="ver el estado"
        cannotDo="aplicar ni revertir versiones"
        missing={['blueprints.apply', 'blueprints.apply']}
      />,
    )
    expect(
      screen.getByText('Podés ver el estado, pero no aplicar ni revertir versiones'),
    ).toBeInTheDocument()
    // Repetida en dos guardas, se nombra una sola vez.
    expect(
      await screen.findByText(
        /«Aplicar y revertir versiones sobre bases reales», blueprints\.apply/,
      ),
    ).toBeInTheDocument()
    // El cierre va en el aviso entero: la etiqueta de la capacidad es solo un nodo adentro.
    const callout = document.getElementById('aviso')
    expect(callout).not.toBeNull()
    expect(callout).toHaveTextContent(/Pedíselo a quien administra los accesos\.$/)
  })

  it('no pinta nada cuando no falta nada', () => {
    mockCatalog()
    renderWithProviders(<CapabilityCallout canDo="ver" cannotDo="tocar" missing={[]} />)
    expect(screen.queryByText(/^Podés /)).not.toBeInTheDocument()
  })

  it('con la capa 2 sin resolver no afirma que falte nada', () => {
    mockCatalog()
    renderWithProviders(
      <CapabilityCallout
        canDo="ver"
        cannotDo="aplicar versiones"
        missing={['blueprints.apply']}
        unresolved="pending"
      />,
    )
    expect(
      screen.getByText('Comprobando si tu acceso permite aplicar versiones en este destino…'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Tu acceso no incluye/)).not.toBeInTheDocument()
  })
})
