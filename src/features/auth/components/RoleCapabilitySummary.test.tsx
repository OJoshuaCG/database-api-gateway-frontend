import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import { RoleCapabilitySummary } from './RoleCapabilitySummary'

describe('RoleCapabilitySummary', () => {
  it('dice cuántas otorga y nombra primero lo destructivo que NO incluye', () => {
    renderWithProviders(<RoleCapabilitySummary role="operator" catalog={CATALOG_FIXTURE} />)
    const text = screen.getByText(/Otorga 16 de 31/).textContent ?? ''
    expect(text).toContain('No incluye:')
    // Lo que no se deshace va primero: borrar usuarios del motor y bases son de `owner`.
    expect(text).toContain('Borrar usuarios del motor')
    expect(text).toContain('Borrar bases de datos')
    expect(text).toMatch(/y \d+ más\./)
  })

  it('comparado con el rol base dice qué pierde', () => {
    renderWithProviders(
      <RoleCapabilitySummary role="viewer" compareTo="operator" catalog={CATALOG_FIXTURE} />,
    )
    // Todo lo perdido es de capa 2: se recorta de verdad y no lleva salvedad.
    expect(screen.getByText(/Respecto de operator pierde 4/)).not.toHaveTextContent('no se recorta')
    // Operator ya no tiene ninguna destructiva (`collation.execute` pasó a `owner`): bajar a viewer
    // no quita ninguna, y la marca no aparece.
    expect(screen.queryByText('Quita destructivas')).not.toBeInTheDocument()
    expect(screen.queryByText('Suma destructivas')).not.toBeInTheDocument()
  })

  it('marca con texto (no solo color) lo destructivo que se SUMA', () => {
    renderWithProviders(
      <RoleCapabilitySummary role="owner" compareTo="viewer" catalog={CATALOG_FIXTURE} />,
    )
    expect(screen.getByText(/Respecto de viewer suma/)).toHaveClass('text-error')
    expect(screen.getByText('Suma destructivas')).toBeInTheDocument()
  })

  it('marca con texto lo destructivo que se pierde', () => {
    renderWithProviders(
      <RoleCapabilitySummary role="viewer" compareTo="owner" catalog={CATALOG_FIXTURE} />,
    )
    expect(screen.getByText(/Respecto de owner pierde/)).toBeInTheDocument()
    expect(screen.getByText('Quita destructivas')).toBeInTheDocument()
  })

  it('igual que el base lo dice en vez de listar nada', () => {
    renderWithProviders(
      <RoleCapabilitySummary role="owner" compareTo="owner" catalog={CATALOG_FIXTURE} />,
    )
    expect(screen.getByText(/Igual que el rol base owner/)).toBeInTheDocument()
  })

  it('sin catálogo no inventa nada', () => {
    renderWithProviders(<RoleCapabilitySummary role="owner" catalog={undefined} />)
    expect(screen.getByText('No se pudo cargar qué incluye este rol.')).toBeInTheDocument()
  })

  it('enlaza a la matriz cuando se pide', () => {
    renderWithProviders(
      <RoleCapabilitySummary role="owner" catalog={CATALOG_FIXTURE} linkToMatrix />,
    )
    expect(screen.getByRole('link', { name: 'Ver todas las capacidades' })).toHaveAttribute(
      'href',
      '/gateway-users?tab=roles',
    )
  })
})
