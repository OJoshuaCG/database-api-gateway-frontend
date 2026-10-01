import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import { RoleCapabilitySummary } from './RoleCapabilitySummary'

describe('RoleCapabilitySummary', () => {
  it('dice cuántas otorga y nombra primero lo destructivo que NO incluye', () => {
    renderWithProviders(<RoleCapabilitySummary role="operator" catalog={CATALOG_FIXTURE} />)
    const text = screen.getByText(/Otorga 17 de 29/).textContent ?? ''
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
    // Misma salvedad que el panel: de lo perdido, hoy solo se recorta `databases.write`.
    expect(screen.getByText(/Respecto de operator pierde 5/)).toHaveTextContent(
      '(solo en borrar y aprovisionar); el resto todavía no).',
    )
    // Operator tiene `collation.execute`, que reescribe tablas en el motor y no se deshace: bajar a
    // viewer QUITA una capacidad destructiva, y eso tiene que verse sin depender del color.
    expect(screen.getByText('Quita destructivas')).toBeInTheDocument()
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
