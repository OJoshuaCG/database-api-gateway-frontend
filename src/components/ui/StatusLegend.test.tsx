import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusLegend } from './StatusLegend'
import { EnvironmentBadge } from './EnvironmentBadge'

describe('StatusLegend', () => {
  it('pinta cada estado con su consecuencia VISIBLE, como par término → definición', () => {
    render(
      <StatusLegend
        items={[
          {
            key: 'unknown',
            label: 'Sin dato',
            tone: 'warning',
            description: 'No se sabe si coincide.',
          },
        ]}
      />,
    )
    // Lo que antes vivía en el `title` del badge —que no llega por teclado ni en táctil— ahora es
    // texto del documento.
    expect(screen.getByText('Sin dato')).toBeInTheDocument()
    expect(screen.getByText('No se sabe si coincide.')).toBeInTheDocument()
    expect(screen.getByRole('term')).toHaveTextContent('Sin dato')
    expect(screen.getByRole('definition')).toHaveTextContent('No se sabe si coincide.')
  })

  it('sin estados no pinta nada: una leyenda vacía es ruido', () => {
    const { container } = render(<StatusLegend items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EnvironmentBadge', () => {
  it('un entorno que bloquea lo dice en texto, no solo con el candado decorativo', () => {
    render(
      <EnvironmentBadge
        state={{ kind: 'assigned', name: 'prod', color: 'error', blocksDestructive: true }}
      />,
    )
    expect(screen.getByText('(bloquea migraciones destructivas)')).toBeInTheDocument()
  })

  it('uno que no bloquea no lo afirma', () => {
    render(
      <EnvironmentBadge
        state={{ kind: 'assigned', name: 'dev', color: null, blocksDestructive: false }}
      />,
    )
    expect(screen.queryByText('(bloquea migraciones destructivas)')).not.toBeInTheDocument()
  })
})
